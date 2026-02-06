import OpenAI from 'openai';
import FaqVector from '../models/faqVector.model.js';
import ApiError from '../utils/ApiError.js';
import config from '../config/config.js';
import * as aiToolService from './aiToolService.js';
import * as conversationService from './conversation.service.js';
import * as blendService from './yarnManagement/blend.service.js';
import * as yarnTypeService from './yarnManagement/yarnType.service.js';
import * as countSizeService from './yarnManagement/countSize.service.js';
import * as colorService from './yarnManagement/color.service.js';
import * as supplierService from './yarnManagement/supplier.service.js';
import * as yarnCatalogService from './yarnManagement/yarnCatalog.service.js';
import * as yarnInventoryService from './yarnManagement/yarnInventory.service.js';
import * as yarnTransactionService from './yarnManagement/yarnTransaction.service.js';
import * as rawMaterialService from './rawMaterial.service.js';
import * as processService from './process.service.js';
import * as productAttributeService from './productAttribute.service.js';
import * as agentUiFlowService from './agent/agentUiFlow.service.js';

const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

/**
 * Stop words: when in PO flow, messages that are ONLY these words (or short phrases of them) do NOT trigger out-of-context intent search. We stay in flow.
 */
const PO_FLOW_STOP_WORDS = new Set([
  'and', 'or', 'the', 'a', 'an', 'it', 'to', 'is', 'in', 'on', 'at', 'for', 'with', 'of', 'by',
  'yeah', 'yes', 'yep', 'yup', 'ok', 'okay', 'sure', 'done', 'no', 'nope', 'cancel', 'y', 'n',
  'confirm', 'place', 'order', 'that', 'all', 'thats', 'that\'s', 'finish', 'complete',
  'more', 'nothing', 'else', 'stop', 'adding', 'im', 'i\'m', 'please', 'thanks', 'thank you'
]);

/**
 * Trigger keywords: when in PO flow, messages containing ANY of these (as whole word or in a phrase) CAN trigger out-of-context intent search (dashboard, sales, analytics, etc.).
 */
const OUT_OF_FLOW_TRIGGER_KEYWORDS = [
  'dashboard', 'capabilities', 'what can you do', 'sales', 'sales data', 'analytics', 'report',
  'store', 'stores', 'store list', 'stores in', 'city', 'cities', 'list of cities',
  'product', 'products', 'top products', 'forecast', 'inventory', 'raw material', 'raw materials',
  'item', 'items', 'item list', 'catalog', 'master catalog',
  'machine', 'machines', 'machine stat', 'machine status', 'floor', 'production', 'production order', 'production dashboard',
  'yarn catalog', 'yarn inventory', 'yarn suppliers', 'yarn types', 'yarn colours', 'yarn colors', 'yarn blend', 'yarn blends', 'yarn count', 'count size',
  'requisition', 'requisitions', 'transaction', 'transactions', 'purchase order', 'purchase orders', 'po status',
  'process', 'processes', 'attribute', 'attributes', 'category', 'categories',
  'show me', 'get me', 'list of', 'retrieve', 'fetch', 'display'
];

/**
 * Add a natural-language agent reply so the chat feels conversational. Mutates and returns the same object.
 * @param {Object} returnObj - The response object to add conversationalMessage to
 * @param {string} userMessage - What the user said
 * @param {Object} opts - { action: string, summary: string, poNumber?: string }
 * @returns {Promise<Object>} Same returnObj with conversationalMessage if GPT replied
 */
const addNaturalReply = async (returnObj, userMessage, opts = {}) => {
  try {
    // Use data-driven intro when provided (e.g. getTopCitiesBySales) to avoid GPT hallucinating (e.g. "New York")
    if (opts.dataDrivenMessage) {
      returnObj.conversationalMessage = opts.dataDrivenMessage;
      return returnObj;
    }
    const msg = await aiToolService.generateNaturalAgentReply(userMessage, opts);
    if (msg) returnObj.conversationalMessage = msg;
  } catch (e) {
    // non-blocking: keep existing response
  }
  return returnObj;
};

/** Persist current flow to session so next message stays in same flow and doesn't fetch unrelated data (e.g. raw materials when in edit PO add-item). */
const persistAgentFlowIfNeeded = (sessionId, out) => {
  if (!sessionId || !out) return;
  if (out.awaitingFollowUp === 'update_status_choice' && out.orderRefForStatus) {
    aiToolService.setAgentFlowSession(sessionId, 'update_status_choice', {
      awaitingFollowUp: out.awaitingFollowUp,
      orderRefForStatus: out.orderRefForStatus
    });
    return;
  }
  if (out.editOrderContext !== undefined) {
    if (out.editOrderContext == null) aiToolService.clearAgentFlowSession(sessionId);
    else aiToolService.setAgentFlowSession(sessionId, 'edit_po', { editOrderPo: out.editOrderContext });
    return;
  }
  if (out.placeOrderContext != null) {
    aiToolService.setAgentFlowSession(sessionId, 'create_po', {
      placeOrderContext: out.placeOrderContext,
      lastOrderWizardPrompt: out.orderWizardPrompt
    });
    return;
  }
  // Both choose_supplier (initial list) and disambiguate_supplier (multiple matches) show a numbered supplier list — persist so "2" = supplier #2
  if ((out.orderWizardPrompt === 'disambiguate_supplier' || out.orderWizardPrompt === 'choose_supplier') && out.matchingSuppliers?.length > 0) {
    aiToolService.setAgentFlowSession(sessionId, 'create_po', {
      lastOrderWizardPrompt: out.orderWizardPrompt,
      matchingSuppliers: out.matchingSuppliers
    });
    return;
  }
  if (out.awaitingFollowUp === 'edit_order_po') {
    aiToolService.setAgentFlowSession(sessionId, 'edit_po', { awaitingFollowUp: out.awaitingFollowUp });
  }
};

// --- Session conversation store (context window in backend) ---
// Full chat context: keep up to 200 turns (400 messages) per session so the agent has whole conversation
const SESSION_CONVERSATION_MAX_TURNS = 200;
/** @type {Map<string, Array<{ role: 'user' | 'assistant'; content: string }>>} */
const sessionConversationStore = new Map();

/**
 * Append a user message to the session's conversation history (backend context window).
 * @param {string} sessionId
 * @param {string} userMessage
 */
export const appendUserMessageToSession = (sessionId, userMessage) => {
  if (!sessionId || typeof userMessage !== 'string') return;
  let arr = sessionConversationStore.get(sessionId);
  if (!arr) {
    arr = [];
    sessionConversationStore.set(sessionId, arr);
  }
  arr.push({ role: 'user', content: userMessage.trim() });
  // Keep only last N turns (each turn = user + assistant, so 2 * max)
  while (arr.length > SESSION_CONVERSATION_MAX_TURNS * 2) arr.shift();
};

/**
 * Get conversation history for a session (for GPT-style context in askQuestion).
 * @param {string} sessionId
 * @returns {Array<{ role: 'user' | 'assistant'; content: string }>}
 */
export const getSessionConversationHistory = (sessionId) => {
  if (!sessionId) return [];
  const arr = sessionConversationStore.get(sessionId);
  return Array.isArray(arr) ? [...arr] : [];
};

/**
 * After askQuestion returns, persist the assistant response into the session's conversation history.
 * @param {string} sessionId
 * @param {string} userMessage - The user message that triggered this response
 * @param {Object} result - The result object from askQuestion (has content in response/html/conversationalMessage etc.)
 */
export const persistSessionConversationFromResponse = (sessionId, userMessage, result) => {
  if (!sessionId || !result) return;
  let arr = sessionConversationStore.get(sessionId);
  if (!arr) {
    arr = [];
    sessionConversationStore.set(sessionId, arr);
  }
  // Ensure last entry is the user message we just processed (might already be added by appendUserMessageToSession)
  const lastUser = arr.length > 0 && arr[arr.length - 1].role === 'user' ? arr[arr.length - 1].content : null;
  if (lastUser !== userMessage?.trim()) {
    arr.push({ role: 'user', content: (userMessage || '').toString().trim() });
  }
  // Store a sentinel for ai_tool HTML responses so conversation fallback recognizes "numeric reply = supplier choice"
  const isAiToolWithData = result.type === 'ai_tool' && (result.response || result.html);
  const assistantText = isAiToolWithData
    ? '(Response with data)'
    : (result.conversationalMessage || result.response || result.html || '').toString().trim().slice(0, 2000) || '(Response)';
  arr.push({ role: 'assistant', content: assistantText });
  while (arr.length > SESSION_CONVERSATION_MAX_TURNS * 2) arr.shift();
};

/**
 * End a chat session: remove conversation history and agent flow so the next message starts fresh.
 * @param {string} sessionId - Session to end
 */
export const endSession = (sessionId) => {
  if (!sessionId || typeof sessionId !== 'string') return;
  sessionConversationStore.delete(sessionId);
  aiToolService.clearSession(sessionId);
};

/** Central disambiguation when intent is null or unclear — same response everywhere so the agent handles ambiguity consistently. */
const getGlobalDisambiguationResponse = () => ({
  type: 'faq',
  response: "I didn't quite get that. You can ask me for: **Sales** (e.g. \"sales from Delhi\", \"sales data highest to lowest\"), **Raw materials** (e.g. \"finished goods in raw material\", \"goods Packing Material\"), **Products** (e.g. \"socks\", \"products in socks category\"), **Yarn** (inventory, orders, catalog, suppliers), **Chat** (e.g. \"what have we discussed\"), or **Orders** (edit order PO-XXX, place order). What do you need?",
  confidence: 0.5,
  source: 'disambiguation',
  clarification: true,
  suggestions: [
    'Sales from Delhi',
    'Finished goods in raw material',
    'Show me socks (products)',
    'Yarn inventory',
    'What have we discussed?'
  ]
});

/**
 * Generate embedding for text using OpenAI
 * @param {string} text - Text to generate embedding for
 * @returns {Promise<Array<number>>} - Embedding vector
 */
const generateEmbedding = async (text) => {
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });
    
    return response.data[0].embedding;
  } catch (error) {
    throw new ApiError(500, `Failed to generate embedding: ${error.message}`);
  }
};

/**
 * Calculate cosine similarity between two vectors
 * @param {Array<number>} vecA - First vector
 * @param {Array<number>} vecB - Second vector
 * @returns {number} - Similarity score between 0 and 1
 */
const cosineSimilarity = (vecA, vecB) => {
  if (vecA.length !== vecB.length) {
    throw new Error('Vectors must have the same length');
  }
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  
  if (normA === 0 || normB === 0) return 0;
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
};

/**
 * Train FAQ with vector embeddings
 * @param {Object} faqData - FAQ data object
 * @returns {Promise<Object>} - Training result
 */
export const trainFAQ = async (faqData) => {
  try {
    const { question, answer } = faqData;
    
    if (!question || !answer) {
      throw new ApiError(400, 'Question and answer are required');
    }
    
    // Generate embedding for the question
    const embedding = await generateEmbedding(question);
    
    // Check if FAQ already exists
    const existingFAQ = await FaqVector.findOne({ question: question.trim() });
    
    if (existingFAQ) {
      // Update existing FAQ
      existingFAQ.answer = answer.trim();
      existingFAQ.embedding = embedding;
      existingFAQ.updatedAt = new Date();
      await existingFAQ.save();
      
      return {
        message: 'FAQ updated successfully',
        faqId: existingFAQ._id,
        action: 'updated'
      };
    } else {
      // Create new FAQ
      const newFAQ = new FaqVector({
        question: question.trim(),
        answer: answer.trim(),
        embedding
      });
      
      await newFAQ.save();
      
      return {
        message: 'FAQ trained successfully',
        faqId: newFAQ._id,
        action: 'created'
      };
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, `Failed to train FAQ: ${error.message}`);
  }
};

/**
 * Bulk train multiple FAQs
 * @param {Array<Object>} faqList - Array of FAQ objects
 * @returns {Promise<Object>} - Bulk training results
 */
export const bulkTrainFAQ = async (faqList) => {
  try {
    if (!Array.isArray(faqList) || faqList.length === 0) {
      throw new ApiError(400, 'FAQ list must be a non-empty array');
    }
    
    if (faqList.length > 100) {
      throw new ApiError(400, 'Maximum 100 FAQs allowed per request');
    }
    
    const results = {
      total: faqList.length,
      created: 0,
      updated: 0,
      failed: 0,
      errors: []
    };
    
    // Process FAQs in parallel with rate limiting
    const batchSize = 10;
    for (let i = 0; i < faqList.length; i += batchSize) {
      const batch = faqList.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (faqData, batchIndex) => {
        const globalIndex = i + batchIndex;
        
        try {
          await trainFAQ(faqData);
          if (faqData.action === 'created') {
            results.created++;
          } else {
            results.updated++;
          }
        } catch (error) {
          results.failed++;
          results.errors.push({
            index: globalIndex,
            question: faqData.question || 'Unknown',
            error: error.message
          });
        }
      });
      
      await Promise.all(batchPromises);
      
      // Small delay between batches to prevent overwhelming the API
      if (i + batchSize < faqList.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return results;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, `Failed to bulk train FAQs: ${error.message}`);
  }
};

/**
 * Detect context category from question
 * @param {string} question - User's question
 * @returns {string|null} Context category or null
 */
const detectContextCategory = (question) => {
  const normalized = question.toLowerCase().trim();
  
  // Map keywords to categories - ordered by specificity (longer/more specific first)
  // This ensures "yarn blend" matches before just "blend"
  const contextMap = [
    // Most specific first
    { keyword: 'yarn blend', category: 'yarn_blends' },
    { keyword: 'yarn blends', category: 'yarn_blends' },
    { keyword: 'yarn type', category: 'yarn_types' },
    { keyword: 'yarn types', category: 'yarn_types' },
    { keyword: 'yarn supplier', category: 'yarn_suppliers' },
    { keyword: 'yarn suppliers', category: 'yarn_suppliers' },
    { keyword: 'yarn color', category: 'yarn_colors' },
    { keyword: 'yarn colors', category: 'yarn_colors' },
    { keyword: 'yarn count size', category: 'yarn_count_sizes' },
    { keyword: 'yarn count sizes', category: 'yarn_count_sizes' },
    { keyword: 'yarn catalog', category: 'yarn_catalog' },
    { keyword: 'yarn catalogue', category: 'yarn_catalog' },
    { keyword: 'yarn inventory', category: 'yarn_inventory' },
    { keyword: 'yarn stock', category: 'yarn_inventory' },
    { keyword: 'yarn transaction', category: 'yarn_transactions' },
    { keyword: 'yarn transactions', category: 'yarn_transactions' },
    { keyword: 'yarn issue', category: 'yarn_issue' },
    { keyword: 'yarn issued', category: 'yarn_issue' },
    { keyword: 'yarn return', category: 'yarn_return' },
    { keyword: 'yarn returned', category: 'yarn_return' },
    { keyword: 'raw material', category: 'raw_materials' },
    { keyword: 'raw materials', category: 'raw_materials' },
    { keyword: 'product attribute', category: 'product_attributes' },
    { keyword: 'product attributes', category: 'product_attributes' },
    { keyword: 'storage slot', category: 'storage_slots' },
    { keyword: 'storage slots', category: 'storage_slots' },
    // Less specific (check after specific ones)
    { keyword: 'count size', category: 'yarn_count_sizes' },
    { keyword: 'count sizes', category: 'yarn_count_sizes' },
    { keyword: 'blends', category: 'yarn_blends' },
    { keyword: 'blend', category: 'yarn_blends' },
    { keyword: 'types', category: 'yarn_types' },
    { keyword: 'type', category: 'yarn_types' },
    { keyword: 'suppliers', category: 'yarn_suppliers' },
    { keyword: 'supplier', category: 'yarn_suppliers' },
    { keyword: 'brands', category: 'yarn_suppliers' },
    { keyword: 'brand', category: 'yarn_suppliers' },
    { keyword: 'colors', category: 'yarn_colors' },
    { keyword: 'color', category: 'yarn_colors' },
    { keyword: 'categories', category: 'categories' },
    { keyword: 'category', category: 'categories' },
    { keyword: 'storage', category: 'storage_slots' },
    { keyword: 'processes', category: 'processes' },
    { keyword: 'process', category: 'processes' },
    { keyword: 'attributes', category: 'product_attributes' },
    { keyword: 'attribute', category: 'product_attributes' },
    { keyword: 'machines', category: 'machines' },
    { keyword: 'machine', category: 'machines' },
    { keyword: 'products', category: 'products' },
    { keyword: 'product', category: 'products' },
    { keyword: 'items', category: 'products' },
    { keyword: 'item', category: 'products' },
  ];
  
  // Check for context keywords (most specific first)
  for (const { keyword, category } of contextMap) {
    // Use word boundaries to avoid partial matches
    const regex = new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'i');
    if (regex.test(normalized)) {
      return category;
    }
  }
  
  return null;
};

/**
 * Fetch context data for a category
 * @param {string} category - Context category
 * @returns {Promise<Object|null>} Context data or null
 */
const fetchContextData = async (category) => {
  try {
    switch (category) {
      case 'yarn_blends':
        const blends = await blendService.queryBlends({}, { limit: 20 });
        return {
          category: 'Yarn Blends',
          data: blends.results || [],
          total: blends.totalResults || 0
        };
      
      case 'yarn_types':
        const yarnTypes = await yarnTypeService.queryYarnTypes({}, { limit: 20 });
        return {
          category: 'Yarn Types',
          data: yarnTypes.results || [],
          total: yarnTypes.totalResults || 0
        };
      
      case 'yarn_suppliers':
        const suppliers = await supplierService.querySuppliers({}, { limit: 20 });
        return {
          category: 'Yarn Suppliers',
          data: suppliers.results || [],
          total: suppliers.totalResults || 0
        };
      
      case 'yarn_colors':
        const colors = await colorService.queryColors({}, { limit: 20 });
        return {
          category: 'Yarn Colors',
          data: colors.results || [],
          total: colors.totalResults || 0
        };
      
      case 'yarn_count_sizes':
        const countSizes = await countSizeService.queryCountSizes({}, { limit: 20 });
        return {
          category: 'Yarn Count Sizes',
          data: countSizes.results || [],
          total: countSizes.totalResults || 0
        };
      
      case 'yarn_catalog':
        const yarnCatalogs = await yarnCatalogService.queryYarnCatalogs({}, { limit: 20 });
        return {
          category: 'Yarn Catalog',
          data: yarnCatalogs.results || [],
          total: yarnCatalogs.totalResults || 0
        };
      
      case 'yarn_inventory':
        const inventories = await yarnInventoryService.queryYarnInventories({}, { limit: 20 });
        return {
          category: 'Yarn Inventory',
          data: inventories.results || [],
          total: inventories.totalResults || 0
        };
      
      case 'raw_materials':
        const rawMaterials = await rawMaterialService.queryRawMaterials({}, { limit: 20 });
        return {
          category: 'Raw Materials',
          data: rawMaterials.results || [],
          total: rawMaterials.totalResults || 0
        };
      
      case 'processes':
        const processes = await processService.queryProcesses({}, { limit: 20 });
        return {
          category: 'Processes',
          data: processes.results || [],
          total: processes.totalResults || 0
        };
      
      case 'product_attributes':
        const attributes = await productAttributeService.queryProductAttributes({}, { limit: 20 });
        return {
          category: 'Product Attributes',
          data: attributes.results || [],
          total: attributes.totalResults || 0
        };
      
      default:
        return null;
    }
  } catch (error) {
    console.error(`Error fetching context data for ${category}:`, error);
    return null;
  }
};

/**
 * Ask question with AI tool calling and FAQ vector search
 * @param {string} question - User's question
 * @param {Object} options - { sessionId?: string } for confirmation guardrails
 * @returns {Promise<Object>} Response object
 */
export const askQuestion = async (question, options = {}) => {
  try {
    if (!question || typeof question !== 'string') {
      throw new ApiError(400, 'Question is required and must be a string');
    }
    
    // Global typo normalization so intent and disambiguation work across all flows (not just a few components)
    const normalizedQuestion = aiToolService.normalizeTyposForAgent(question.trim());
    if (normalizedQuestion.length === 0) {
      throw new ApiError(400, 'Question cannot be empty');
    }

    let { sessionId, context, conversationHistory } = options;
    context = context && typeof context === 'object' ? { ...context } : {};
    // Use backend session conversation store when no history provided. Read history BEFORE appending current message so numeric-reply disambiguate (e.g. "3" = supplier choice) can use previous turn.
    if ((!conversationHistory || !Array.isArray(conversationHistory) || conversationHistory.length === 0) && sessionId) {
      conversationHistory = getSessionConversationHistory(sessionId);
    }
    const historyBeforeCurrentMessage = conversationHistory ? [...conversationHistory] : [];

    // Build context for GPT: overview of whole chat + recent messages (so we don't send full transcript every time; full chat stays in session/local)
    let contextForIntent = { conversationHistory: Array.isArray(conversationHistory) ? conversationHistory : [] };
    if (Array.isArray(conversationHistory) && conversationHistory.length > 20) {
      try {
        const overview = await aiToolService.getConversationOverview(conversationHistory);
        if (overview) {
          contextForIntent = { conversationOverview: overview, conversationHistory: conversationHistory.slice(-20) };
        }
      } catch (e) {
        console.warn('[askQuestion] getConversationOverview failed, using recent only:', e?.message);
        contextForIntent = { conversationHistory: conversationHistory.slice(-20) };
      }
    }

    // Merge session-stored flow context so agent stays in the same flow (e.g. edit PO add-item) and doesn't fetch unrelated data when client didn't send context
    if (sessionId) {
      const stored = aiToolService.getAgentFlowSession(sessionId);
      if (stored?.context) {
        if (stored.context.editOrderPo != null && context.editOrderPo == null) context.editOrderPo = stored.context.editOrderPo;
        if (stored.context.placeOrderContext != null && context.placeOrderContext == null) context.placeOrderContext = stored.context.placeOrderContext;
        if (stored.context.awaitingFollowUp != null && context.awaitingFollowUp == null) context.awaitingFollowUp = stored.context.awaitingFollowUp;
        if (stored.context.orderRefForStatus != null && context.orderRefForStatus == null) context.orderRefForStatus = stored.context.orderRefForStatus;
        if (stored.context.lastOrderWizardPrompt != null && context.lastOrderWizardPrompt == null) context.lastOrderWizardPrompt = stored.context.lastOrderWizardPrompt;
        if (stored.context.matchingSuppliers != null && context.matchingSuppliers == null) context.matchingSuppliers = stored.context.matchingSuppliers;
      }
    }

    // Resolve pending confirmation FIRST (place-order yes/no, delete/status confirm) so "yeah"/"yes" at order summary doesn't trigger detectIntent → capabilities
    if (sessionId) {
      const resolved = await aiToolService.resolvePendingConfirmation(sessionId, normalizedQuestion);
      if (resolved.resolved && resolved.response != null) {
        if (!resolved.isRePrompt) aiToolService.clearAgentFlowSession(sessionId);
        const out = {
          type: 'ai_tool',
          intent: { action: 'confirm_or_cancel' },
          response: resolved.response,
          confidence: 1,
          source: 'ai_tool_service',
          confirmationResolved: true
        };
        if (resolved.agentJobId != null) out.agentJobId = resolved.agentJobId;
        if (resolved.poNumber && out.agentJobId == null) {
          console.warn('[faq] Order placed but agentJobId missing from resolvePendingConfirmation', { poNumber: resolved.poNumber });
        }
        const summary = resolved.poNumber ? `Order placed with PO number ${resolved.poNumber}.` : 'Done.';
        const dataDrivenMessage = resolved.isRePrompt ? 'Please type **yes** to confirm or **no** to cancel.' : undefined;
        return await addNaturalReply(out, normalizedQuestion, { action: 'confirm action', summary, dataDrivenMessage });
      }
    }

    // When in PO create/edit flow: let GPT decide if the user is asking something else (out of context). If so, break the flow and answer that intent.
    // Use PO_FLOW_STOP_WORDS and OUT_OF_FLOW_TRIGGER_KEYWORDS: stay in flow when message is only stop words; run check only when message contains a trigger keyword.
    const inPoFlow = context?.placeOrderContext != null || (context?.editOrderPo?.purchaseOrderId != null);
    const isPurelyNumeric = /^\s*\d+(\.\d+)?\s*$/.test(normalizedQuestion.trim());
    const stopwordsForList = /\b(add|i|want|need|the|and|yarn|items?|please|get|give\s+me)\b/gi;
    const normalizedForList = normalizedQuestion.replace(/,/g, ' ').replace(stopwordsForList, ' ').replace(/\s+/g, ' ').trim();
    const looksLikeListOfNumbers = /^\s*\d+(\s+\d+)+\s*$/.test(normalizedForList);
    const isNumericOrListReply = isPurelyNumeric || looksLikeListOfNumbers;
    const finalizePhraseInFlow = /^(?:(?:yeah|yeap|yep|yes|yup|ok|sure)\s+)?done\s*\.?$|^(?:done|that'?s\s+all|thats\s+all|that'?s\s+it|thats\s+it|finish|complete|no\s+more|finalize|place\s+order|i'?m\s+done|im\s+done|stop\s+adding|that\s+is\s+all|nothing\s+else|no\s+more\s+items)\s*\.?$/i.test(normalizedQuestion.trim());
    const msgTrimmed = normalizedQuestion.trim();
    const words = msgTrimmed.toLowerCase().split(/\s+/).filter(Boolean);
    const isOnlyStopWords = words.length > 0 && words.every((w) => {
      const clean = w.replace(/[^\w']/g, '');
      return PO_FLOW_STOP_WORDS.has(clean) || PO_FLOW_STOP_WORDS.has(clean.replace(/'/g, ''));
    });
    const msgLower = msgTrimmed.toLowerCase();
    const hasTriggerKeyword = OUT_OF_FLOW_TRIGGER_KEYWORDS.some((kw) => msgLower.includes(kw.toLowerCase()));
    if (inPoFlow && sessionId && !isNumericOrListReply && !finalizePhraseInFlow && !isOnlyStopWords && hasTriggerKeyword) {
      const earlyIntent = await aiToolService.detectIntent(normalizedQuestion, contextForIntent);
      const nonPoDataActions = new Set([
        'getStoresList', 'getSalesData', 'getSalesReport', 'getAnalyticsDashboard', 'getTopCitiesBySales',
        'getProductsList', 'getTopProducts', 'getProductAnalysis', 'getProductForecast', 'getProductCount',
        'getRawMaterials', 'getStoreAnalysisByName', 'getBrandPerformance',
        'getYarnCatalog', 'getYarnInventory', 'getLiveInventory', 'getYarnPurchaseOrders', 'getYarnPurchaseOrderById', 'getYarnPurchaseOrderCounts',
        'getYarnTransactions', 'getYarnRequisitions', 'getYarnTypes', 'getYarnSuppliers', 'getYarnCountSizes', 'getYarnColors', 'getYarnBlends',
        'getMachineStatistics', 'getMachinesByStatus', 'getMachinesByFloor', 'getProductionOrders', 'getProductionDashboard',
        'getCapabilities', 'getOrders'
      ]);
      const isOtherIntent = earlyIntent && nonPoDataActions.has(earlyIntent.action) && (earlyIntent.confidence ?? 0) >= 0.6;
      if (isOtherIntent) {
        aiToolService.clearAgentFlowSession(sessionId);
        context.placeOrderContext = null;
        context.editOrderPo = null;
        context.lastOrderWizardPrompt = null;
        context.matchingSuppliers = null;
        try {
          const aiResponse = await aiToolService.executeAITool(earlyIntent, { sessionId });
          const html = typeof aiResponse === 'string' ? aiResponse : (aiResponse?.html ?? '');
          const responsePayload = html ? { response: html } : { response: aiResponse?.message || 'Done.' };
          const out = {
            type: 'ai_tool',
            intent: earlyIntent,
            ...responsePayload,
            confidence: earlyIntent.confidence ?? 0.9,
            source: 'ai_tool_service',
            contextUsed: true
          };
          if (aiResponse?.salesDataPagination) out.salesDataPagination = aiResponse.salesDataPagination;
          const summary = earlyIntent.description || 'Retrieved the requested information.';
          return await addNaturalReply(out, normalizedQuestion, { action: earlyIntent.action, summary, dataDrivenMessage: aiResponse?.dataDrivenMessage });
        } catch (err) {
          console.warn('Out-of-context intent execution failed (continuing in PO flow):', err?.message);
        }
      }
    }

    // When in PO flow and user asks for supplier list / start over / new order — clear flow and show supplier list from the start
    const wantsSupplierListOrRestart =
      inPoFlow &&
      /\b(?:show\s+me\s+)?(?:the\s+)?supplier\s+list\b|\bsupplier\s+list\b|start\s+over|start\s+from\s+start|new\s+order\b|begin\s+again|restart\b/i.test(normalizedQuestion.trim());
    if (wantsSupplierListOrRestart && sessionId) {
      aiToolService.clearAgentFlowSession(sessionId);
      context.placeOrderContext = null;
      context.lastOrderWizardPrompt = null;
      context.matchingSuppliers = null;
      try {
        const aiResponse = await aiToolService.executeAITool(
          { action: 'createYarnPurchaseOrder', params: {}, confidence: 0.95 },
          { sessionId }
        );
        const isPromptPayload = aiResponse && typeof aiResponse === 'object' && aiResponse.html != null && aiResponse.orderWizardPrompt != null;
        const responsePayload = isPromptPayload
          ? {
              response: aiResponse.html,
              orderWizardPrompt: aiResponse.orderWizardPrompt,
              ...(aiResponse.matchingSuppliers != null && { matchingSuppliers: aiResponse.matchingSuppliers })
            }
          : { response: typeof aiResponse === 'string' ? aiResponse : (aiResponse?.html ?? String(aiResponse)) };
        const out = {
          type: 'ai_tool',
          intent: { action: 'createYarnPurchaseOrder', params: {} },
          ...responsePayload,
          confidence: 0.95,
          source: 'ai_tool_service',
          contextUsed: true
        };
        persistAgentFlowIfNeeded(sessionId, out);
        return await addNaturalReply(out, normalizedQuestion, { action: 'create purchase order', summary: 'Choose a supplier and optionally a colour.' });
      } catch (err) {
        console.warn('Supplier list / restart failed:', err?.message);
      }
    }

    // Sales data pagination: "page 2", "next page", "previous page" when user was viewing sales data
    const salesFlowStored = sessionId ? aiToolService.getAgentFlowSession(sessionId) : null;
    const isSalesPaginationMsg = /^(?:page\s+(\d+)|next\s+page|previous\s+page|prev\s+page)\s*$/i.test(normalizedQuestion.trim());
    if (isSalesPaginationMsg && salesFlowStored?.flow === 'sales_data' && salesFlowStored?.context?.salesDataParams) {
      const params = salesFlowStored.context.salesDataParams;
      const totalPages = salesFlowStored.context.totalPages || 1;
      let page = 1;
      const pageMatch = normalizedQuestion.match(/page\s+(\d+)/i);
      if (pageMatch) {
        page = Math.max(1, Math.min(totalPages, parseInt(pageMatch[1], 10)));
      } else if (/next\s+page/i.test(normalizedQuestion)) {
        page = Math.min(totalPages, (salesFlowStored.context.currentPage || 1) + 1);
      } else if (/(?:previous|prev)\s+page/i.test(normalizedQuestion)) {
        page = Math.max(1, (salesFlowStored.context.currentPage || 1) - 1);
      }
      try {
        const salesResponse = await aiToolService.executeAITool(
          { action: 'getSalesData', params: { ...params, page }, confidence: 0.95 },
          { sessionId }
        );
        const html = typeof salesResponse === 'string' ? salesResponse : (salesResponse?.html ?? '');
        const out = {
          type: 'ai_tool',
          intent: { action: 'getSalesData', params: { ...params, page } },
          response: html,
          confidence: 0.95,
          source: 'ai_tool_service',
          contextUsed: true
        };
        if (salesResponse?.salesDataPagination) out.salesDataPagination = salesResponse.salesDataPagination;
        return await addNaturalReply(out, normalizedQuestion, { action: 'sales data', summary: `Showing page ${salesResponse?.salesDataPagination?.currentPage || page} of sales data.` });
      } catch (err) {
        console.warn('Sales pagination failed:', err?.message);
      }
    }

    // Early sales intent: if message clearly asks for sales data, run detectIntent and handle getSalesData before any yarn/purchase flow (so "sales from Delhi" is never interpreted as supplier)
    const looksLikeSalesRequest = /\bsales\b/i.test(normalizedQuestion) && /\b(?:data|from|in|for|show|list|records|me)\b/i.test(normalizedQuestion);
    if (looksLikeSalesRequest) {
      const salesIntent = await aiToolService.detectIntent(normalizedQuestion, contextForIntent);
      if (salesIntent?.action === 'getSalesData') {
        try {
          const salesResponse = await aiToolService.executeAITool(salesIntent, { sessionId });
          const html = typeof salesResponse === 'string' ? salesResponse : (salesResponse?.html ?? '');
          const out = {
            type: 'ai_tool',
            intent: salesIntent,
            response: html,
            confidence: salesIntent.confidence ?? 0.95,
            source: 'ai_tool_service'
          };
          if (salesResponse?.salesDataPagination) out.salesDataPagination = salesResponse.salesDataPagination;
          return await addNaturalReply(out, normalizedQuestion, { action: 'sales data', summary: 'Showing sales data.' });
        } catch (err) {
          console.warn('Early sales intent execution failed:', err?.message);
        }
      }
    }

    // When user replied with a number (1, 2) after "which supplier?" — handle first so intent/conversation never see "1" as product or vague query
    const disambiguateStored = sessionId ? aiToolService.getAgentFlowSession(sessionId) : null;
    let disambiguatePrompt = context?.lastOrderWizardPrompt ?? disambiguateStored?.context?.lastOrderWizardPrompt;
    let disambiguateSuppliers = context?.matchingSuppliers ?? disambiguateStored?.context?.matchingSuppliers;

    // Fallback: recover from conversation when session/context lost — last assistant asked "which supplier?" and user replied with a number (use history before current message so "3" is not yet in history)
    const isNumericReply = /^\d+$/.test(normalizedQuestion.trim());
    if (isNumericReply && (!disambiguateSuppliers?.length || disambiguatePrompt !== 'disambiguate_supplier') && Array.isArray(historyBeforeCurrentMessage) && historyBeforeCurrentMessage.length >= 2) {
      const lastAssistant = [...historyBeforeCurrentMessage].reverse().find((m) => m.role === 'assistant');
      const lastContent = (lastAssistant?.content || '').toString();
      // Previous user message that triggered the list (e.g. "purchase yarn from wampum") — the one before the last assistant
      let prevUserContent = '';
      for (let i = historyBeforeCurrentMessage.length - 1; i >= 0; i--) {
        if (historyBeforeCurrentMessage[i].role === 'assistant') {
          for (let j = i - 1; j >= 0; j--) {
            if (historyBeforeCurrentMessage[j].role === 'user') {
              prevUserContent = (historyBeforeCurrentMessage[j].content || '').toString();
              break;
            }
          }
          break;
        }
      }
      const assistantAskedWhichSupplier = /which one do you mean|reply with the number\s*\(e\.g\.\s*1 or 2\)|matching\s+["']/i.test(lastContent) || /there are \d+ suppliers matching/i.test(lastContent);
      // Last assistant was supplier list (Response with data) and user had any purchase/buy/order yarn message (e.g. "i wanna purchase yarn", "buy yarn from wampum")
      const purchaseYarnInPrev = /\b(?:purchase|buy|order|get|want|wanna)\s+.*yarn|\byarn\s+from\s+/i.test(prevUserContent);
      const assistantWasDataResponse = /^\(Response with data\)$|^\(Response\)$/i.test(lastContent.trim()) && purchaseYarnInPrev;
      const looksLikeSupplierDisambiguation = assistantAskedWhichSupplier || assistantWasDataResponse;
      if (looksLikeSupplierDisambiguation && prevUserContent) {
        const fromMatch = prevUserContent.match(/(?:purchase|buy|order|get)\s+(?:some\s+)?(?:.+?\s+)?yarn\s+from\s+(.+)/i) || prevUserContent.match(/yarn\s+from\s+(.+)/i);
        const specificSupplier = fromMatch ? fromMatch[1].replace(/\s+in\s+colou?r\s+.+$/i, '').replace(/\s+something\s+(?:in\s+)?.+$/i, '').trim() : null;
        // Use empty params to get full supplier list (choose_supplier); only use supplierQuery when user had named a supplier (e.g. "yarn from wampum")
        const refetchParams = specificSupplier && specificSupplier.length >= 2 && specificSupplier.length <= 80
          ? { supplierQuery: specificSupplier }
          : {};
        try {
          const refetch = await aiToolService.executeAITool(
            { action: 'createYarnPurchaseOrder', params: refetchParams, confidence: 0.95 },
            { sessionId }
          );
          if (refetch?.matchingSuppliers?.length > 0 && (refetch?.orderWizardPrompt === 'disambiguate_supplier' || refetch?.orderWizardPrompt === 'choose_supplier')) {
            disambiguatePrompt = refetch.orderWizardPrompt;
            disambiguateSuppliers = refetch.matchingSuppliers;
          }
        } catch (e) {
          // ignore
        }
      }
    }

    // Helper: show yarn list for chosen supplier (by id), used for both number and name selection
    const showYarnListForSupplier = async (chosen) => {
      if (!chosen?.id) return null;
      if (sessionId) appendUserMessageToSession(sessionId, normalizedQuestion);
      const aiResponse = await aiToolService.executeAITool(
        { action: 'createYarnPurchaseOrder', params: { showSupplierList: true, preSelectedSupplierId: chosen.id }, confidence: 0.95 },
        { sessionId }
      );
      const isPromptPayload = aiResponse && typeof aiResponse === 'object' && aiResponse.html != null && aiResponse.orderWizardPrompt != null;
      const responsePayload = isPromptPayload
        ? {
            response: aiResponse.html,
            orderWizardPrompt: aiResponse.orderWizardPrompt,
            ...(aiResponse.placeOrderContext != null && { placeOrderContext: aiResponse.placeOrderContext })
          }
        : { response: typeof aiResponse === 'string' ? aiResponse : (aiResponse?.html ?? String(aiResponse)), ...(aiResponse?.placeOrderContext != null && { placeOrderContext: aiResponse.placeOrderContext }) };
      const out = {
        type: 'ai_tool',
        intent: { action: 'createYarnPurchaseOrder', params: { preSelectedSupplierId: chosen.id } },
        ...responsePayload,
        confidence: 0.95,
        source: 'ai_tool_service',
        contextUsed: true
      };
      persistAgentFlowIfNeeded(sessionId, out);
      return await addNaturalReply(out, normalizedQuestion, { action: 'create purchase order', summary: 'Found supplier; choose yarn next.' });
    };

    // choose_supplier / disambiguate_supplier: user selects by NUMBER (e.g. "3") → show top 5 yarn items for that supplier
    if ((disambiguatePrompt === 'choose_supplier' || disambiguatePrompt === 'disambiguate_supplier') && disambiguateSuppliers?.length > 0 && isNumericReply) {
      const num = parseInt(normalizedQuestion.trim(), 10);
      if (num >= 1 && num <= disambiguateSuppliers.length) {
        const chosen = disambiguateSuppliers[num - 1];
        try {
          return await showYarnListForSupplier(chosen);
        } catch (err) {
          console.warn('Disambiguate supplier selection failed:', err?.message);
        }
      }
    }

    // In supplier selection context but user sent comma-separated or invalid number(s) — keep context and ask for one valid number
    if ((disambiguatePrompt === 'choose_supplier' || disambiguatePrompt === 'disambiguate_supplier') && disambiguateSuppliers?.length > 0 && /^\d+(\s*,\s*\d+)*$/.test(normalizedQuestion.trim())) {
      const parts = normalizedQuestion.trim().split(/\s*,\s*/).map((s) => parseInt(s, 10)).filter((n) => !Number.isNaN(n) && n >= 1 && n <= disambiguateSuppliers.length);
      if (parts.length === 1) {
        const chosen = disambiguateSuppliers[parts[0] - 1];
        try {
          return await showYarnListForSupplier(chosen);
        } catch (err) {
          console.warn('Supplier selection failed:', err?.message);
        }
      }
      const n = disambiguateSuppliers.length;
      const hint = getGlobalDisambiguationResponse();
      const out = { ...hint, response: `Please pick one supplier by number (1 to ${n}). Reply with a single number, e.g. 1 or 3.` };
      return await addNaturalReply(out, normalizedQuestion, { action: 'create purchase order', summary: `Pick a supplier (1–${n}).` });
    }

    // choose_supplier / disambiguate_supplier + non-numeric reply: first use GPT to see if user is asking something else (e.g. "show me dashboard analytics"). No supplier is named "no show me dashboard analytics".
    if ((disambiguatePrompt === 'choose_supplier' || disambiguatePrompt === 'disambiguate_supplier') && disambiguateSuppliers?.length > 0 && !isNumericReply) {
      const earlyIntent = await aiToolService.detectIntent(normalizedQuestion, contextForIntent);
      const nonPoDataActions = new Set([
        'getStoresList', 'getSalesData', 'getSalesReport', 'getAnalyticsDashboard', 'getTopCitiesBySales',
        'getProductsList', 'getTopProducts', 'getProductAnalysis', 'getProductForecast', 'getProductCount',
        'getRawMaterials', 'getStoreAnalysisByName', 'getBrandPerformance',
        'getYarnCatalog', 'getYarnInventory', 'getLiveInventory', 'getYarnPurchaseOrders', 'getYarnPurchaseOrderById', 'getYarnPurchaseOrderCounts',
        'getYarnTransactions', 'getYarnRequisitions', 'getYarnTypes', 'getYarnSuppliers', 'getYarnCountSizes', 'getYarnColors', 'getYarnBlends',
        'getMachineStatistics', 'getMachinesByStatus', 'getMachinesByFloor', 'getProductionOrders', 'getProductionDashboard',
        'getCapabilities', 'getOrders'
      ]);
      const isOtherIntent = earlyIntent && nonPoDataActions.has(earlyIntent.action) && (earlyIntent.confidence ?? 0) >= 0.6;
      if (isOtherIntent) {
        if (sessionId) aiToolService.clearAgentFlowSession(sessionId);
        context.placeOrderContext = null;
        context.lastOrderWizardPrompt = null;
        context.matchingSuppliers = null;
        try {
          const aiResponse = await aiToolService.executeAITool(earlyIntent, { sessionId });
          const html = typeof aiResponse === 'string' ? aiResponse : (aiResponse?.html ?? '');
          const responsePayload = html ? { response: html } : { response: aiResponse?.message || 'Done.' };
          const out = {
            type: 'ai_tool',
            intent: earlyIntent,
            ...responsePayload,
            confidence: earlyIntent.confidence ?? 0.9,
            source: 'ai_tool_service',
            contextUsed: true
          };
          if (aiResponse?.salesDataPagination) out.salesDataPagination = aiResponse.salesDataPagination;
          const summary = earlyIntent.description || 'Retrieved the requested information.';
          return await addNaturalReply(out, normalizedQuestion, { action: earlyIntent.action, summary, dataDrivenMessage: aiResponse?.dataDrivenMessage });
        } catch (err) {
          console.warn('Out-of-context (supplier step) intent execution failed:', err?.message);
        }
      }
    }

    // choose_supplier / disambiguate_supplier: user selects by NAME (e.g. "WAMPUM", "from wampum", "Premier Threads") → show top 5 yarn items for that supplier
    if ((disambiguatePrompt === 'choose_supplier' || disambiguatePrompt === 'disambiguate_supplier') && disambiguateSuppliers?.length > 0 && !isNumericReply) {
      const rawQuery = normalizedQuestion.trim();
      if (rawQuery.length >= 2 && rawQuery.length <= 80) {
        // Normalize: "from wampum", "buy from wampum", "get yarn from wampum" → "wampum" so we match supplier name
        const fromPrefix = /^(?:i\s+(?:wanna|want\s+to)\s+)?(?:buy|get|order|purchase)\s+(?:yarn\s+)?from\s+|^from\s+|^go\s+with\s+|^choose\s+(?:option\s+)?/i;
        let query = rawQuery.replace(fromPrefix, '').trim() || rawQuery;
        const queryLower = query.toLowerCase();
        let chosen = disambiguateSuppliers.find((s) => {
          const name = (s.brandName || s.name || '').toLowerCase();
          return name.includes(queryLower) || queryLower.includes(name) || name.replace(/\s+/g, '').includes(queryLower.replace(/\s+/g, ''));
        });
        // When direct/regex match fails, use GPT to interpret (e.g. "from wampum" → supplier name "wampum")
        if (!chosen && rawQuery.length >= 2) {
          try {
            const gptChoice = await aiToolService.interpretSupplierChoiceWithGPT(rawQuery, disambiguateSuppliers);
            if (gptChoice?.supplierNumber != null && gptChoice.supplierNumber >= 1 && gptChoice.supplierNumber <= disambiguateSuppliers.length) {
              chosen = disambiguateSuppliers[gptChoice.supplierNumber - 1];
            } else if (gptChoice?.supplierQuery && gptChoice.supplierQuery.length >= 2) {
              const gptQueryLower = gptChoice.supplierQuery.trim().toLowerCase();
              chosen = disambiguateSuppliers.find((s) => {
                const name = (s.brandName || s.name || '').toLowerCase();
                return name.includes(gptQueryLower) || gptQueryLower.includes(name) || name.replace(/\s+/g, '').includes(gptQueryLower.replace(/\s+/g, ''));
              });
            }
          } catch (err) {
            console.warn('interpretSupplierChoiceWithGPT (choose_supplier) failed:', err?.message);
          }
        }
        if (chosen) {
          try {
            return await showYarnListForSupplier(chosen);
          } catch (err) {
            console.warn('Supplier name selection failed:', err?.message);
          }
        }
      }
    }

    // Append current user message to session so context window and persistSessionConversationFromResponse have full history
    if (sessionId) appendUserMessageToSession(sessionId, normalizedQuestion);
    if (sessionId && (!conversationHistory || conversationHistory.length === 0)) conversationHistory = getSessionConversationHistory(sessionId);

    // ─── Four separate PO flows (do not merge; they may share helpers but must not conflict) ───
    // 1. Create PO: placeOrderContext — new order, choose supplier, choose yarn, place.
    // 2. Edit/Update PO: editOrderPo / editOrderContext — change items, quantity, add/remove (NOT status).
    // 3. Update status PO: orderRefForStatus, awaitingFollowUp 'update_status_po' | 'update_status_choice' — change status only.
    // 4. Delete PO: deleteYarnPurchaseOrder intent — delete order (no persistent context).
    // When in edit flow, explicit "update status" or "delete this order" is routed to flow 3 or 4 below.

    // Fallback: "add item" / "add more yarn" without editOrderPo — recover edit context from last assistant message (e.g. "What would you like to edit?" + PO-2026-975) so we show order's supplier yarn list, not create-PO supplier list
    const vagueAddItemOnly = /^(?:i\s+)?(?:wanna|want\s+to)\s+add\s+(?:an?\s+)?(?:item|more\s+yarn|more\s+items?)\s*\.?$|^add\s+(?:an?\s+)?(?:item|more\s+yarn|more\s+items?)\s*\.?$/i.test(normalizedQuestion.trim());
    // Also fallback: "do you have anything in blue" / colour keyword when last message was add-item yarn list — so we search order's supplier yarns, not raw materials
    const colourKeywordQuestion = /^(?:do\s+you\s+have\s+(?:anything\s+in\s+|something\s+in\s+)?|anything\s+in\s+|something\s+in\s+|do\s+you\s+have\s+)(.+)$/i.test(normalizedQuestion.trim()) && normalizedQuestion.trim().length >= 10;
    const tryEditFallback = !context?.editOrderPo?.purchaseOrderId && (vagueAddItemOnly || colourKeywordQuestion) && Array.isArray(conversationHistory) && conversationHistory.length > 0;
    if (tryEditFallback) {
      const lastAssistant = [...conversationHistory].reverse().find((m) => m.role === 'assistant');
      const lastContent = (lastAssistant?.content || '').toString();
      // Match edit-PO screen, or add-item yarn list, or natural summary (e.g. "You can select a yarn to add to your order by number or name from the list provided")
      const hasEditPrompt = /what would you like to edit\?/i.test(lastContent) || /edit\s+more\s+or\s+complete/i.test(lastContent) || /edited\s+purchase\s+order\s+PO-?/i.test(lastContent) || /purchase\s+order:\s*PO-?/i.test(lastContent) || /here are yarn items from/i.test(lastContent) || /here are yarns from/i.test(lastContent) || /choose a yarn from the list/i.test(lastContent) || /select a yarn to add/i.test(lastContent) || /yarn to add to your order/i.test(lastContent) || /from the list provided/i.test(lastContent) || /number or name from the list/i.test(lastContent) || /keyword.*(?:number or name|blue)/i.test(lastContent);
      // Get PO from last assistant message or from any recent message (in case summary doesn't include PO)
      let poInMessage = lastContent.match(/\bPO-?\s*(\d{4}-\d{2,})\b/i) || lastContent.match(/\b(\d{4}-\d{2,})\b/);
      if (!poInMessage && Array.isArray(conversationHistory)) {
        for (let i = conversationHistory.length - 1; i >= 0; i--) {
          const c = (conversationHistory[i].content || '').toString();
          const m = c.match(/\bPO-?\s*(\d{4}-\d{2,})\b/i) || c.match(/\b(\d{4}-\d{2,})\b/);
          if (m) {
            poInMessage = m;
            break;
          }
        }
      }
      const poNumber = poInMessage ? (poInMessage[0].toUpperCase().startsWith('PO') ? poInMessage[0].replace(/\s+/g, '') : `PO-${poInMessage[1]}`) : null;
      // For colour-keyword questions ("do you have anything in blue") only need PO in conversation — don't route to raw materials. For "add item" we need hasEditPrompt too.
      const shouldRunEditFallback = poNumber && (hasEditPrompt || colourKeywordQuestion);
      if (shouldRunEditFallback) {
        try {
          const editCtx = await aiToolService.getEditOrderContextFromPoNumber(poNumber);
          if (editCtx) {
            const result = await aiToolService.applyYarnPurchaseOrderEdit(editCtx.purchaseOrderId, normalizedQuestion, editCtx);
            const responseStr = result.html || '';
            const resolvedPoNum = result.editOrderContext?.poNumber ?? editCtx.poNumber;
            let editSummary = (responseStr.includes('Here are yarn items from') || responseStr.includes('Here are yarns from')) && result.editOrderContext?.addItemState ? 'Showing yarn list to add to order. Pick a yarn by number or name.' : 'Processed your order edit.';
            const out = {
              type: 'ai_tool',
              intent: { action: 'applyYarnPurchaseOrderEdit' },
              response: responseStr,
              confidence: 0.95,
              source: 'ai_tool_service',
              contextUsed: true,
              ...(result.editOrderContext !== undefined && { editOrderContext: result.editOrderContext })
            };
            persistAgentFlowIfNeeded(sessionId, out);
            return await addNaturalReply(out, normalizedQuestion, { action: 'edit order', summary: editSummary, poNumber: resolvedPoNum });
          }
        } catch (err) {
          console.warn('Edit-order add-item fallback failed:', err?.message);
        }
      }
    }

    // In-chat EDIT flow: when we're editing an order (context.editOrderPo), handle only edit-detail actions (items, qty, add, remove). Route status/delete to their own flows.
    if (context?.editOrderPo?.purchaseOrderId) {
      const poId = context.editOrderPo.purchaseOrderId;
      const poNum = context.editOrderPo.poNumber;
      const msg = normalizedQuestion.trim().toLowerCase();

      // Explicit status update while in edit context → run UPDATE STATUS flow only (do not handle in edit flow)
      const statusUpdatePhrase = /^(?:set|update|change)\s+status\s+to\s+.+|^mark\s+(?:this\s+order\s+)?as\s+(?:in\s+transit|goods\s+received|qc\s+pending|submitted|po\s+accepted|po\s+rejected|goods\s+partially\s+received|po\s+accepted\s+partially)/i.test(normalizedQuestion.trim()) ||
        /^(?:set|update|change)\s+status\s+to\s+.+/i.test(normalizedQuestion.trim());
      if (statusUpdatePhrase) {
        try {
          const statusMatch = normalizedQuestion.match(/(?:to|as)\s+([\w\s]+?)(?:\s*\.|$)/i) || normalizedQuestion.match(/status\s+to\s+([\w\s]+)/i);
          const statusPhrase = (statusMatch && statusMatch[1]) ? statusMatch[1].trim() : '';
          const aiResponse = await aiToolService.executeAITool(
            { action: 'updateYarnPurchaseOrderStatus', params: { purchaseOrderId: poId, poNumber: poNum, status_code: statusPhrase || undefined }, confidence: 0.95 },
            { sessionId }
          );
          const responseStr = typeof aiResponse === 'string' ? aiResponse : (aiResponse?.html ?? String(aiResponse));
          const isChoosingStatus = aiResponse?.needsStatusChoice && aiResponse?.orderRef;
          const out = {
            type: 'ai_tool',
            intent: { action: 'updateYarnPurchaseOrderStatus', params: { poNumber: poNum } },
            response: responseStr,
            confidence: 0.95,
            source: 'ai_tool_service',
            contextUsed: true,
            ...(isChoosingStatus ? { awaitingFollowUp: 'update_status_choice', orderRefForStatus: aiResponse.orderRef, editOrderContext: null } : { editOrderContext: { purchaseOrderId: poId, poNumber: poNum } })
          };
          persistAgentFlowIfNeeded(sessionId, out);
          const summary = isChoosingStatus ? 'Choose status by number (1–8).' : 'Updated the order status.';
          return await addNaturalReply(out, normalizedQuestion, { action: 'update order status', summary, poNumber: poNum });
        } catch (err) {
          console.warn('Update status from edit context failed:', err?.message);
        }
      }

      // Explicit delete while in edit context → run DELETE flow only (then clear edit context)
      const deletePhrase = /^(?:delete|cancel|remove)\s+(?:this\s+)?(?:order|po)\s*\.?$/i.test(normalizedQuestion.trim());
      if (deletePhrase) {
        try {
          const aiResponse = await aiToolService.executeAITool(
            { action: 'deleteYarnPurchaseOrder', params: { purchaseOrderId: poId, poNumber: poNum }, confidence: 0.95 },
            { sessionId }
          );
          const responseStr = typeof aiResponse === 'string' ? aiResponse : (aiResponse?.html ?? String(aiResponse));
          const out = {
            type: 'ai_tool',
            intent: { action: 'deleteYarnPurchaseOrder', params: { poNumber: poNum } },
            response: responseStr,
            confidence: 0.95,
            source: 'ai_tool_service',
            contextUsed: true,
            editOrderContext: null
          };
          persistAgentFlowIfNeeded(sessionId, out);
          return await addNaturalReply(out, normalizedQuestion, { action: 'delete order', summary: 'Order deleted.', poNumber: poNum });
        } catch (err) {
          console.warn('Delete from edit context failed:', err?.message);
        }
      }

      // Confirm delete after "remove item" when only one item → run DELETE flow and clear edit context
      const confirmDelete = context.editOrderPo.confirmDeleteOrder && /^(?:yes|yeah|y|ok|sure)\s*,?\s*(?:delete\s+(?:this\s+)?(?:order|po))?\.?$/i.test(normalizedQuestion.trim());
      if (confirmDelete) {
        try {
          const aiResponse = await aiToolService.executeAITool(
            { action: 'deleteYarnPurchaseOrder', params: { purchaseOrderId: poId, poNumber: poNum }, confidence: 0.95 },
            { sessionId }
          );
          const responseStr = typeof aiResponse === 'string' ? aiResponse : (aiResponse?.html ?? String(aiResponse));
          const out = {
            type: 'ai_tool',
            intent: { action: 'deleteYarnPurchaseOrder', params: { poNumber: poNum } },
            response: responseStr,
            confidence: 0.95,
            source: 'ai_tool_service',
            contextUsed: true,
            editOrderContext: null
          };
          persistAgentFlowIfNeeded(sessionId, out);
          return await addNaturalReply(out, normalizedQuestion, { action: 'delete order', summary: 'Order deleted.', poNumber: poNum });
        } catch (err) {
          console.warn('Confirm delete from edit context failed:', err?.message);
        }
      }

      try {
        const result = await aiToolService.applyYarnPurchaseOrderEdit(
          poId,
          normalizedQuestion,
          context.editOrderPo
        );
        const responseStr = result.html || '';
        const resolvedPoNum = result.editOrderContext?.poNumber ?? poNum;
        let editSummary = 'Processed your order edit.';
        if (responseStr && typeof responseStr === 'string') {
          if (responseStr.includes('Quantity Updated')) editSummary = 'Updated the quantity.';
          else if (responseStr.includes('Status Updated')) editSummary = 'Updated the order status.';
          else if (responseStr.includes('Change quantity')) editSummary = 'Helping you change the quantity.';
          else if (responseStr.includes('Items Removed')) editSummary = 'Removed the selected items from the order.';
          else if (responseStr.includes('Item Removed')) editSummary = 'Removed the item.';
          else if (responseStr.includes('Item Added')) editSummary = 'Added the item.';
          else if (responseStr.includes('Order Complete') || responseStr.includes('Edit Cancelled')) editSummary = 'Finished with the order edit.';
          else if (responseStr.includes('How can I help you?') && result.editOrderContext == null) editSummary = 'No problem! How can I help you?';
          else if (responseStr.includes('Confirm removal') && result.editOrderContext?.removeItemState?.step === 'confirm_remove') editSummary = 'Confirm removal: type yes to remove these items or no to cancel.';
          else if (responseStr.includes('Remove item') && result.editOrderContext?.removeItemState?.step === 'choose_items') editSummary = 'Pick item(s) to remove by number (e.g. 1 or 1, 3).';
          else if ((responseStr.includes('Add item') || responseStr.includes('Here are yarn items from')) && result.editOrderContext?.addItemState) editSummary = 'Showing yarn list to add to order. Pick a yarn by number or name.';
          else if ((responseStr.includes('Only one item') || responseStr.includes('delete the entire order')) && result.editOrderContext?.confirmDeleteOrder) editSummary = 'Asking if you want to delete the order. Reply yes, delete order to delete.';
        }
        const out = {
          type: 'ai_tool',
          intent: { action: 'applyYarnPurchaseOrderEdit' },
          response: responseStr,
          confidence: 0.95,
          source: 'ai_tool_service',
          contextUsed: true,
          ...(result.editOrderContext !== undefined && { editOrderContext: result.editOrderContext })
        };
        persistAgentFlowIfNeeded(sessionId, out);
        const replyOpts = { action: 'edit order', summary: editSummary, poNumber: resolvedPoNum };
        if (result.editOrderContext == null && responseStr.includes('How can I help you?')) replyOpts.dataDrivenMessage = 'No problem! How can I help you?';
        return await addNaturalReply(out, normalizedQuestion, replyOpts);
      } catch (err) {
        console.warn('Apply edit failed:', err?.message);
      }
    }

    // Run order-action intent (edit/delete/update status) early so "i wanna edit order PO-2026-979" is never treated as place-order keyword
    const orderActionRegex = /\b(delete|cancel|remove|update|mark|set|edit)\b.*\b(?:purchase\s+)?order\b|edit\s+order|edit\s+po-?[\w\-]+/i;
    if (orderActionRegex.test(normalizedQuestion)) {
      const orderIntent = await aiToolService.detectIntent(normalizedQuestion, contextForIntent);
      if (orderIntent && (orderIntent.action === 'deleteYarnPurchaseOrder' || orderIntent.action === 'updateYarnPurchaseOrderStatus' || orderIntent.action === 'editYarnPurchaseOrder')) {
        try {
          const aiResponse = await aiToolService.executeAITool(orderIntent, { sessionId });
          const responseStr = typeof aiResponse === 'string' ? aiResponse : (aiResponse?.html ?? String(aiResponse));
          const isAskingWhichOrderToEdit = orderIntent.action === 'editYarnPurchaseOrder' && /please specify which order to edit/i.test(responseStr);
          const isChoosingStatus = aiResponse?.needsStatusChoice && aiResponse?.orderRef;
          const isAskingOrderForStatus = orderIntent.action === 'updateYarnPurchaseOrderStatus' && /please specify which order/i.test(responseStr);
          const actionLabel = orderIntent.action === 'deleteYarnPurchaseOrder' ? 'delete order' : orderIntent.action === 'updateYarnPurchaseOrderStatus' ? 'update order status' : 'edit order';
          const summary = isAskingWhichOrderToEdit ? 'Need the PO number to open it for editing.' : isChoosingStatus ? 'Choose status by number (1–8).' : isAskingOrderForStatus ? 'Need the PO number to update status.' : (orderIntent.action === 'editYarnPurchaseOrder' ? 'Showing order details.' : orderIntent.description || 'Done.');
          const out = {
            type: 'ai_tool',
            intent: orderIntent,
            response: responseStr,
            confidence: orderIntent.confidence ?? 0.95,
            source: 'ai_tool_service',
            orderActionHandled: true,
            ...(isAskingWhichOrderToEdit ? { awaitingFollowUp: 'edit_order_po' } : {}),
            ...(isAskingOrderForStatus ? { awaitingFollowUp: 'update_status_po' } : {}),
            ...(isChoosingStatus ? { awaitingFollowUp: 'update_status_choice', orderRefForStatus: aiResponse.orderRef } : {}),
            ...(aiResponse?.editOrderContext && { editOrderContext: aiResponse.editOrderContext })
          };
          persistAgentFlowIfNeeded(sessionId, out);
          return await addNaturalReply(out, normalizedQuestion, { action: actionLabel, summary, poNumber: orderIntent.params?.poNumber });
        } catch (orderErr) {
          console.warn('Order action execution failed, continuing:', orderErr?.message);
        }
      }
    }

    // Session context: when we asked "which order to edit?" and user replies with a PO number, treat as edit that order
    const poNumberMatch = normalizedQuestion.match(/^(?:po-?)?(\d{4}-\d{2,})$/i) || (normalizedQuestion.length <= 20 && normalizedQuestion.match(/^po-?[a-z0-9\-]+$/i));
    const poForFollowUp = poNumberMatch ? (poNumberMatch[0].toUpperCase().startsWith('PO') ? poNumberMatch[0] : `PO-${poNumberMatch[1]}`) : null;
    if (poForFollowUp) {
      if (context?.awaitingFollowUp === 'edit_order_po') {
        try {
          const aiResponse = await aiToolService.executeAITool(
            { action: 'editYarnPurchaseOrder', params: { poNumber: poForFollowUp }, confidence: 0.95 },
            { sessionId }
          );
          const responseStr = typeof aiResponse === 'string' ? aiResponse : (aiResponse?.html ?? '');
          const out = {
            type: 'ai_tool',
            intent: { action: 'editYarnPurchaseOrder', params: { poNumber: poForFollowUp } },
            response: responseStr,
            confidence: 0.95,
            source: 'ai_tool_service',
            contextUsed: true,
            awaitingFollowUp: null,
            ...(aiResponse?.editOrderContext && { editOrderContext: aiResponse.editOrderContext })
          };
          return await addNaturalReply(out, normalizedQuestion, { action: 'open order for editing', summary: `Showing order ${poForFollowUp} so you can edit it.`, poNumber: poForFollowUp });
        } catch (err) {
          console.warn('Edit order follow-up failed:', err?.message);
        }
      } else if (context?.awaitingFollowUp === 'update_status_po') {
        try {
          const aiResponse = await aiToolService.executeAITool(
            { action: 'updateYarnPurchaseOrderStatus', params: { poNumber: poForFollowUp }, confidence: 0.95 },
            { sessionId }
          );
          const responseStr = typeof aiResponse === 'string' ? aiResponse : (aiResponse?.html ?? String(aiResponse));
          const isChoosingStatus = aiResponse?.needsStatusChoice && aiResponse?.orderRef;
          const out = {
            type: 'ai_tool',
            intent: { action: 'updateYarnPurchaseOrderStatus', params: { poNumber: poForFollowUp } },
            response: responseStr,
            confidence: 0.95,
            source: 'ai_tool_service',
            contextUsed: true,
            awaitingFollowUp: isChoosingStatus ? 'update_status_choice' : null,
            ...(isChoosingStatus && { orderRefForStatus: aiResponse.orderRef })
          };
          return await addNaturalReply(out, normalizedQuestion, { action: 'update order status', summary: `Choose new status for ${poForFollowUp}.`, poNumber: poForFollowUp });
        } catch (err) {
          console.warn('Update status PO follow-up failed:', err?.message);
        }
      } else if (Array.isArray(conversationHistory) && conversationHistory.length >= 2) {
        const lastAssistant = conversationHistory.filter(m => m.role === 'assistant').pop();
        const lastContent = (lastAssistant?.content || '').toLowerCase();
        const wasAskingWhichOrderToEdit = /which order to edit|specify which order|edit yarn purchase order details/i.test(lastContent);
        if (wasAskingWhichOrderToEdit) {
          try {
            const aiResponse = await aiToolService.executeAITool(
              { action: 'editYarnPurchaseOrder', params: { poNumber: poForFollowUp }, confidence: 0.95 },
              { sessionId }
            );
            const responseStr = typeof aiResponse === 'string' ? aiResponse : (aiResponse?.html ?? '');
            const out = {
              type: 'ai_tool',
              intent: { action: 'editYarnPurchaseOrder', params: { poNumber: poForFollowUp } },
              response: responseStr,
              confidence: 0.95,
              source: 'ai_tool_service',
              contextUsed: true,
              ...(aiResponse?.editOrderContext && { editOrderContext: aiResponse.editOrderContext })
            };
            return await addNaturalReply(out, normalizedQuestion, { action: 'open order for editing', summary: `Showing order ${poForFollowUp} so you can edit it.`, poNumber: poForFollowUp });
          } catch (err) {
            console.warn('Edit order follow-up from history failed:', err?.message);
          }
        }
      }
    }

    // Place-order chat flow: choose yarn from list, then quantity → rate → gst one by one, then done → summary + confirm
    // Stay in flow when we have supplier + yarn list (even if lastOrderWizardPrompt is missing), so user's yarn reply isn't treated as new intent
    const inPlaceOrderYarnFlow =
      context?.placeOrderContext &&
      (context?.lastOrderWizardPrompt === 'choose_yarn_from_supplier' ||
        context?.placeOrderContext?.collectingStep ||
        context?.placeOrderContext?.yarnDisambiguationList ||
        (context.placeOrderContext.supplierId && (context.placeOrderContext.yarnNames?.length ?? 0) > 0));
    if (inPlaceOrderYarnFlow) {
      try {
        // When user says "yes"/"y"/"confirm" and we have order summary (collectedItems), place the order and return PO number (same as resolvePendingConfirmation; handles missing sessionId or lost pending)
        const isConfirmPlace = /^(?:yes|y|confirm)\s*$/i.test(normalizedQuestion.trim());
        const hasCollectedItems = (context.placeOrderContext?.collectedItems?.length ?? 0) > 0;
        if (isConfirmPlace && hasCollectedItems) {
          try {
            const { created, total, poItems } = await aiToolService.createPurchaseOrderFromPlaceContext(context.placeOrderContext);
            const html = `Purchase order <strong>${created.poNumber}</strong> created successfully with ${poItems.length} item(s). Total: ₹${total.toLocaleString()}. Opening the form so you can see it.`;
            const out = {
              type: 'ai_tool',
              intent: { action: 'createYarnPurchaseOrder' },
              response: html,
              orderWizardPrompt: undefined,
              placeOrderContext: undefined,
              confidence: 1,
              source: 'ai_tool_service',
              contextUsed: true
            };
            const jobId = `JOB_${Date.now()}`;
            out.agentJobId = jobId;
            try {
              const purchaseDate = new Date().toISOString().slice(0, 10);
              const deliveryDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
              const agentContext = {
                order: {
                  purchaseDate,
                  supplierName: context.placeOrderContext.supplierName || '',
                  notes: '',
                  items: (poItems || []).map((p) => ({
                    yarnName: p.yarnName || '',
                    size: p.sizeCount || 'N/A',
                    shade: p.shadeCode || '',
                    rate: p.rate,
                    qty: p.quantity,
                    delivery: deliveryDate,
                    gst: p.gstRate ?? 0
                  }))
                }
              };
              await agentUiFlowService.createJob({
                jobId,
                flowKey: 'purchase.po.create.ui',
                refType: 'PO',
                refId: created.poNumber,
                context: agentContext
              });
              await agentUiFlowService.startUiFlow(jobId);
            } catch (agentErr) {
              console.warn('Agent UI flow create/start failed (order still placed):', agentErr?.message);
            }
            if (sessionId) aiToolService.clearAgentFlowSession(sessionId);
            return await addNaturalReply(out, normalizedQuestion, { action: 'place order', summary: `Order placed with PO number ${created.poNumber}.`, poNumber: created.poNumber });
          } catch (placeErr) {
            console.warn('Place order from context failed:', placeErr?.message);
          }
        }
        // "no"/"n"/"cancel" at summary step — cancel and clear context
        const isCancelPlace = /^(?:no|n|cancel)\s*$/i.test(normalizedQuestion.trim());
        if (isCancelPlace && hasCollectedItems) {
          if (sessionId) aiToolService.clearAgentFlowSession(sessionId);
          const out = {
            type: 'ai_tool',
            intent: { action: 'createYarnPurchaseOrder' },
            response: 'Order cancelled. You can start a new order by saying "place order".',
            orderWizardPrompt: undefined,
            placeOrderContext: undefined,
            confidence: 1,
            source: 'ai_tool_service',
            contextUsed: true
          };
          return await addNaturalReply(out, normalizedQuestion, { action: 'cancel order', summary: 'Order cancelled.' });
        }

        const result = await aiToolService.handlePlaceOrderYarnChat(context.placeOrderContext, normalizedQuestion);
        if (result.needsPlaceOrderConfirmation && sessionId && result.placeOrderContext) {
          aiToolService.setPendingPlaceOrderConfirmation(sessionId, { placeOrderContext: result.placeOrderContext });
          const out = {
            type: 'ai_tool',
            intent: { action: 'createYarnPurchaseOrder' },
            response: result.html,
            orderWizardPrompt: undefined,
            placeOrderContext: result.placeOrderContext,
            confidence: 0.95,
            source: 'ai_tool_service',
            contextUsed: true
          };
          persistAgentFlowIfNeeded(sessionId, out);
          return await addNaturalReply(out, normalizedQuestion, { action: 'place order', summary: result.summary || 'Review order. Type yes to place or no to cancel.' });
        }
        const out = {
          type: 'ai_tool',
          intent: { action: 'createYarnPurchaseOrder' },
          response: result.html,
          orderWizardPrompt: result.orderWizardPrompt ?? undefined,
          ...(result.placeOrderContext != null && { placeOrderContext: result.placeOrderContext }),
          confidence: 0.95,
          source: 'ai_tool_service',
          contextUsed: true
        };
        // When no match or disambiguation, use action/summary so the LLM doesn't say "order placed"
        const isNoMatch = (result.summary || '').includes('No match') || (result.html || '').includes('No match');
        const isDisambiguation = (result.summary || '').includes('Multiple yarns match') || (result.html || '').includes('Which yarn?');
        const replyAction = isNoMatch ? 'yarn search (no match)' : isDisambiguation ? 'yarn search (disambiguation)' : 'place order (chat)';
        const replySummary = isNoMatch ? 'No matching yarn. Try a different keyword or pick from the list by number.' : isDisambiguation ? 'Multiple yarns match; choose by number.' : (result.summary || 'Processing.');
        persistAgentFlowIfNeeded(sessionId, out);
        const returned = await addNaturalReply(out, normalizedQuestion, { action: replyAction, summary: replySummary });
        // For no-match, show only the natural GPT reply; clear the rigid "No match" HTML so the UI shows just the conversational message
        if (isNoMatch && returned.conversationalMessage) {
          returned.response = '';
        }
        return returned;
      } catch (err) {
        console.warn('Place order chat flow failed:', err?.message);
      }
    }

    // "Which supplier has [colour] yarn?" / "Which suppliers have blue yarn?" — list suppliers that have that colour in yarn name
    const whichSupplierHasColourMatch = normalizedQuestion.match(/which\s+suppliers?\s+has\s+(.+?)\s+yarn\b/i) || normalizedQuestion.match(/which\s+suppliers?\s+have\s+(.+?)\s+yarn\b/i);
    if (whichSupplierHasColourMatch) {
      const colour = whichSupplierHasColourMatch[1].trim();
      if (colour.length >= 2 && colour.length <= 40) {
        try {
          const html = await aiToolService.getSuppliersByYarnColour({ colour });
          const out = {
            type: 'ai_tool',
            intent: { action: 'getSuppliersByYarnColour', params: { colour } },
            response: typeof html === 'string' ? html : (html?.html ?? String(html)),
            confidence: 0.95,
            source: 'ai_tool_service'
          };
          return await addNaturalReply(out, normalizedQuestion, { action: 'suppliers by colour', summary: `Suppliers that have ${colour} yarn.` });
        } catch (err) {
          console.warn('getSuppliersByYarnColour failed:', err?.message);
        }
      }
    }

    // GPT-first: any yarn purchase related message — let GPT extract intent and params for free-flow chat
    const looksLikeYarnPurchase = /\byarn\b/i.test(normalizedQuestion) && /\b(buy|purchase|order|get|want|need|from|wanna)\b/i.test(normalizedQuestion);
    if (looksLikeYarnPurchase && normalizedQuestion.length >= 10) {
      try {
        const interpreted = await aiToolService.interpretYarnPurchaseMessage(normalizedQuestion, {
          supplierName: context?.placeOrderContext?.supplierName,
          yarnNames: context?.placeOrderContext?.yarnNames
        });
        if (interpreted) {
          if (interpreted.intent === 'show_lists') {
            const aiResponse = await aiToolService.executeAITool(
              { action: 'createYarnPurchaseOrder', params: {}, confidence: 0.95 },
              { sessionId }
            );
            const isPromptPayload = aiResponse && typeof aiResponse === 'object' && aiResponse.html != null && aiResponse.orderWizardPrompt != null;
            const responsePayload = isPromptPayload
              ? {
                  response: aiResponse.html,
                  orderWizardPrompt: aiResponse.orderWizardPrompt,
                  ...(aiResponse.matchingSuppliers != null && { matchingSuppliers: aiResponse.matchingSuppliers })
                }
              : { response: typeof aiResponse === 'string' ? aiResponse : (aiResponse?.html ?? String(aiResponse)) };
            const out = { type: 'ai_tool', intent: { action: 'createYarnPurchaseOrder', params: {} }, ...responsePayload, confidence: 0.95, source: 'ai_tool_service', contextUsed: true };
            persistAgentFlowIfNeeded(sessionId, out);
            return await addNaturalReply(out, normalizedQuestion, { action: 'create purchase order', summary: 'Choose a supplier and optionally a colour.' });
          }
          if ((interpreted.intent === 'create_order' || interpreted.intent === 'choose_supplier') && interpreted.supplierQuery) {
            const params = {
              supplierQuery: interpreted.supplierQuery,
              supplierNumber: /^\d+$/.test(interpreted.supplierQuery) ? parseInt(interpreted.supplierQuery, 10) : undefined
            };
            if (interpreted.yarnHint) params.yarnHint = interpreted.yarnHint;
            if (interpreted.poItems?.length) params.poItems = interpreted.poItems;
            const aiResponse = await aiToolService.executeAITool(
              { action: 'createYarnPurchaseOrder', params, confidence: 0.95 },
              { sessionId }
            );
            if (aiResponse?.needsPlaceOrderConfirmation && aiResponse?.placeOrderContext && sessionId) {
              aiToolService.setPendingPlaceOrderConfirmation(sessionId, { placeOrderContext: aiResponse.placeOrderContext });
              const out = { type: 'ai_tool', intent: { action: 'createYarnPurchaseOrder' }, response: aiResponse.html, confidence: 0.95, source: 'ai_tool_service', contextUsed: true };
              return await addNaturalReply(out, normalizedQuestion, { action: 'place order', summary: aiResponse.summary || 'Review order. Type yes to place or no to cancel.' });
            }
            const isWizardPayload = aiResponse && typeof aiResponse === 'object' && aiResponse.html != null && aiResponse.orderWizardData != null;
            const isPromptPayload = aiResponse && typeof aiResponse === 'object' && aiResponse.html != null && aiResponse.orderWizardPrompt != null;
            const responsePayload = isWizardPayload
              ? { response: aiResponse.html, orderWizardData: aiResponse.orderWizardData }
              : isPromptPayload
                ? {
                    response: aiResponse.html,
                    orderWizardPrompt: aiResponse.orderWizardPrompt,
                    ...(aiResponse.placeOrderContext != null && { placeOrderContext: aiResponse.placeOrderContext })
                  }
                : { response: typeof aiResponse === 'string' ? aiResponse : (aiResponse?.html ?? String(aiResponse)), ...(aiResponse?.placeOrderContext != null && { placeOrderContext: aiResponse.placeOrderContext }) };
            const out = { type: 'ai_tool', intent: { action: 'createYarnPurchaseOrder', params }, ...responsePayload, confidence: 0.95, source: 'ai_tool_service', contextUsed: true };
            const summary = isPromptPayload ? 'Found supplier; choose yarn next.' : isWizardPayload ? 'Starting purchase order.' : 'Processing your order.';
            return await addNaturalReply(out, normalizedQuestion, { action: 'create purchase order', summary });
          }
        }
      } catch (err) {
        console.warn('GPT yarn purchase interpret failed, falling back to regex:', err?.message);
      }
    }

    // "I want to buy yarn" / "purchase yarn" without "from [supplier]" — show supplier list and colour list so user can choose (regex fallback)
    const buyYarnNoSupplier = /(?:i\s+)?(?:want\s+to\s+)?(?:purchase|buy|but|order|get)\s+(?:some\s+)?yarn\b/i.test(normalizedQuestion) && !/\bfrom\s+/.test(normalizedQuestion);
    if (buyYarnNoSupplier) {
      try {
        const aiResponse = await aiToolService.executeAITool(
          { action: 'createYarnPurchaseOrder', params: {}, confidence: 0.95 },
          { sessionId }
        );
        const isPromptPayload = aiResponse && typeof aiResponse === 'object' && aiResponse.html != null && aiResponse.orderWizardPrompt != null;
        const responsePayload = isPromptPayload
          ? {
              response: aiResponse.html,
              orderWizardPrompt: aiResponse.orderWizardPrompt,
              ...(aiResponse.matchingSuppliers != null && { matchingSuppliers: aiResponse.matchingSuppliers })
            }
          : { response: typeof aiResponse === 'string' ? aiResponse : (aiResponse?.html ?? String(aiResponse)) };
        const out = {
          type: 'ai_tool',
          intent: { action: 'createYarnPurchaseOrder', params: {} },
          ...responsePayload,
          confidence: 0.95,
          source: 'ai_tool_service',
          contextUsed: true
        };
        persistAgentFlowIfNeeded(sessionId, out);
        return await addNaturalReply(out, normalizedQuestion, { action: 'create purchase order', summary: 'Choose a supplier and optionally a colour.' });
      } catch (err) {
        console.warn('Create yarn order (no supplier) failed, continuing:', err?.message);
      }
    }

    // "I want to / wanna purchase/buy/but [blue] yarn from [supplier]" — extract supplier and optional colour hint (before "yarn" or "in colour X")
    const purchaseYarnFromMatch = normalizedQuestion.match(/(?:i\s+)?(?:want\s+to\s+|wanna\s+)?(?:purchase|buy|but|order|get)\s+(?:some\s+)?(.+?)\s+yarn\s+from\s+(.+)/i)
      || normalizedQuestion.match(/(?:i\s+)?(?:want\s+to\s+|wanna\s+)?(?:purchase|buy|but|order|get)\s+(?:some\s+)?yarn\s+from\s+(.+)/i);
    let supplierFromPhrase = null;
    let yarnHint = null;
    if (purchaseYarnFromMatch) {
      if (purchaseYarnFromMatch[2]) {
        supplierFromPhrase = purchaseYarnFromMatch[2].trim();
        const beforeYarn = (purchaseYarnFromMatch[1] || '').trim();
        if (beforeYarn && beforeYarn.length >= 2 && !/^some$/i.test(beforeYarn)) yarnHint = beforeYarn;
      } else {
        supplierFromPhrase = purchaseYarnFromMatch[1].trim();
      }
    }
    if (supplierFromPhrase) {
      const colourMatch = supplierFromPhrase.match(/\s+in\s+colou?r\s+(.+)$/i);
      if (colourMatch) {
        yarnHint = colourMatch[1].trim();
        supplierFromPhrase = supplierFromPhrase.replace(/\s+in\s+colou?r\s+.+$/i, '').trim();
      }
      const hintMatch = supplierFromPhrase.match(/\s+something\s+(?:in\s+)?(.+)$/i);
      if (hintMatch) yarnHint = hintMatch[1].trim();
      supplierFromPhrase = supplierFromPhrase.replace(/\s+something\s+(?:in\s+)?.+$/i, '').trim();
    }
    const hasInlineOrder = /\bpieces?\b/i.test(supplierFromPhrase) && (/\bgst\b/i.test(supplierFromPhrase) || /for\s+\d/i.test(supplierFromPhrase));
    const supplierQueryMaxLen = hasInlineOrder ? 500 : 80;
    if (supplierFromPhrase && supplierFromPhrase.length >= 2 && supplierFromPhrase.length <= supplierQueryMaxLen) {
      try {
        const params = { supplierQuery: supplierFromPhrase, supplierNumber: /^\d+$/.test(supplierFromPhrase) ? parseInt(supplierFromPhrase, 10) : undefined };
        if (yarnHint && yarnHint.length >= 2) params.yarnHint = yarnHint;
        const aiResponse = await aiToolService.executeAITool(
          { action: 'createYarnPurchaseOrder', params, confidence: 0.95 },
          { sessionId }
        );
        if (aiResponse?.needsPlaceOrderConfirmation && aiResponse?.placeOrderContext && sessionId) {
          aiToolService.setPendingPlaceOrderConfirmation(sessionId, { placeOrderContext: aiResponse.placeOrderContext });
          const out = { type: 'ai_tool', intent: { action: 'createYarnPurchaseOrder', params: { supplierQuery: supplierFromPhrase } }, response: aiResponse.html, confidence: 0.95, source: 'ai_tool_service', contextUsed: true };
          return await addNaturalReply(out, normalizedQuestion, { action: 'place order', summary: aiResponse.summary || 'Review order. Type yes to place or no to cancel.' });
        }
        const isWizardPayload = aiResponse && typeof aiResponse === 'object' && aiResponse.html != null && aiResponse.orderWizardData != null;
        const isPromptPayload = aiResponse && typeof aiResponse === 'object' && aiResponse.html != null && aiResponse.orderWizardPrompt != null;
        const responsePayload = isWizardPayload
          ? { response: aiResponse.html, orderWizardData: aiResponse.orderWizardData }
          : isPromptPayload
            ? {
                response: aiResponse.html,
                orderWizardPrompt: aiResponse.orderWizardPrompt,
                ...(aiResponse.preSelectedSupplier != null && { preSelectedSupplier: aiResponse.preSelectedSupplier }),
                ...(aiResponse.matchingSuppliers != null && { matchingSuppliers: aiResponse.matchingSuppliers }),
                ...(aiResponse.placeOrderContext != null && { placeOrderContext: aiResponse.placeOrderContext })
              }
            : { response: typeof aiResponse === 'string' ? aiResponse : (aiResponse?.html ?? String(aiResponse)), ...(aiResponse?.placeOrderContext != null && { placeOrderContext: aiResponse.placeOrderContext }) };
        const out = {
          type: 'ai_tool',
          intent: { action: 'createYarnPurchaseOrder', params: { supplierQuery: supplierFromPhrase } },
          ...responsePayload,
          confidence: 0.95,
          source: 'ai_tool_service',
          contextUsed: true
        };
        persistAgentFlowIfNeeded(sessionId, out);
        const summary = isPromptPayload ? 'Found supplier; choose yarn next.' : isWizardPayload ? 'Starting purchase order.' : 'Processing your order.';
        return await addNaturalReply(out, normalizedQuestion, { action: 'create purchase order', summary });
      } catch (err) {
        console.warn('Purchase yarn from supplier failed, continuing:', err?.message);
      }
    }

    // When user is in "choose supplier" flow, treat short reply as supplier name (e.g. "wampum", "allen solley") or number (1, 2)
    if (context?.lastOrderWizardPrompt === 'choose_supplier') {
      const isShowList = /show\s+(?:me\s+)?(?:the\s+)?supplier\s+list|supplier\s+list|see\s+(?:the\s+)?supplier\s+list|option\s*2|choose\s+from\s+(?:the\s+)?list|show\s+list/i.test(normalizedQuestion);
      if (!isShowList && normalizedQuestion.length >= 1 && normalizedQuestion.length <= 80) {
        try {
          const aiResponse = await aiToolService.executeAITool(
            { action: 'createYarnPurchaseOrder', params: { supplierQuery: normalizedQuestion, supplierNumber: /^\d+$/.test(normalizedQuestion) ? parseInt(normalizedQuestion, 10) : undefined }, confidence: 0.95 },
            { sessionId }
          );
          if (aiResponse?.needsPlaceOrderConfirmation && aiResponse?.placeOrderContext && sessionId) {
            aiToolService.setPendingPlaceOrderConfirmation(sessionId, { placeOrderContext: aiResponse.placeOrderContext });
            const out = { type: 'ai_tool', intent: { action: 'createYarnPurchaseOrder', params: { supplierQuery: normalizedQuestion } }, response: aiResponse.html, confidence: 0.95, source: 'ai_tool_service', contextUsed: true };
            return await addNaturalReply(out, normalizedQuestion, { action: 'place order', summary: aiResponse.summary || 'Review order. Type yes to place or no to cancel.' });
          }
          const isWizardPayload = aiResponse && typeof aiResponse === 'object' && aiResponse.html != null && aiResponse.orderWizardData != null;
          const isPromptPayload = aiResponse && typeof aiResponse === 'object' && aiResponse.html != null && aiResponse.orderWizardPrompt != null;
          const responsePayload = isWizardPayload
            ? { response: aiResponse.html, orderWizardData: aiResponse.orderWizardData }
            : isPromptPayload
              ? {
                  response: aiResponse.html,
                  orderWizardPrompt: aiResponse.orderWizardPrompt,
                  ...(aiResponse.preSelectedSupplier != null && { preSelectedSupplier: aiResponse.preSelectedSupplier }),
                  ...(aiResponse.matchingSuppliers != null && { matchingSuppliers: aiResponse.matchingSuppliers }),
                  ...(aiResponse.placeOrderContext != null && { placeOrderContext: aiResponse.placeOrderContext })
                }
              : { response: typeof aiResponse === 'string' ? aiResponse : (aiResponse?.html ?? String(aiResponse)), ...(aiResponse?.placeOrderContext != null && { placeOrderContext: aiResponse.placeOrderContext }) };
          const out = {
            type: 'ai_tool',
            intent: { action: 'createYarnPurchaseOrder', params: { supplierQuery: normalizedQuestion } },
            ...responsePayload,
            confidence: 0.95,
            source: 'ai_tool_service',
            contextUsed: true
          };
          const summary = isPromptPayload ? 'Found supplier; choose yarn next.' : isWizardPayload ? 'Starting purchase order.' : 'Processing your order.';
          return await addNaturalReply(out, normalizedQuestion, { action: 'create purchase order', summary });
        } catch (contextErr) {
          console.warn('Context createYarnPurchaseOrder failed, falling back to normal flow:', contextErr.message);
        }
      }
    }

    // Status choice follow-up: we asked "which status?" (numbered list excluding current); user replies with a number → ask for confirmation
    if (context?.awaitingFollowUp === 'update_status_choice' && context?.orderRefForStatus) {
      const currentStatus = context.orderRefForStatus.currentStatus || null;
      const statusOption = aiToolService.getStatusOptionByNumberExcluding(normalizedQuestion, currentStatus);
      if (statusOption) {
        try {
          const aiResponse = await aiToolService.executeAITool(
            { action: 'updateYarnPurchaseOrderStatus', params: { ...context.orderRefForStatus, status_code: statusOption.code }, confidence: 0.95 },
            { sessionId }
          );
          const responseStr = typeof aiResponse === 'string' ? aiResponse : (aiResponse?.html ?? String(aiResponse));
          const out = {
            type: 'ai_tool',
            intent: { action: 'updateYarnPurchaseOrderStatus', params: { ...context.orderRefForStatus, status_code: statusOption.code } },
            response: responseStr,
            confidence: 0.95,
            source: 'ai_tool_service',
            contextUsed: true,
            awaitingFollowUp: null
          };
          return await addNaturalReply(out, normalizedQuestion, { action: 'update order status', summary: `Confirm update to ${statusOption.label}.`, poNumber: context.orderRefForStatus.poNumber });
        } catch (err) {
          console.warn('Status choice follow-up failed:', err?.message);
        }
      }
    }

    // Check for slash commands (e.g., /commands, /help)
    if (normalizedQuestion.startsWith('/')) {
      const command = normalizedQuestion.toLowerCase();
      if (command === '/commands' || command === '/help' || command === '/') {
        const commandsResult = await aiToolService.getCommands();
        return {
          type: 'ai_tool',
          intent: commandsResult.intent,
          response: commandsResult.response,
          confidence: 1.0,
          source: 'slash_command',
          data: {
            type: 'ai_tool',
            intent: commandsResult.intent,
            response: commandsResult.response
          }
        };
      }
    }

    // Conversation summary: "what have we discussed?", "summarize our chat" — answer from session history only; no tool/search (guardrail: don't misuse as data request)
    const conversationMetaPatterns = [
      /what\s+have\s+we\s+(?:discussed|chatted|talked)\s+about/i,
      /what\s+(?:have\s+we|did\s+we)\s+discuss/i,
      /summar(?:y|ies|ize)\s+(?:our\s+)?(?:chat|conversation|discussion)/i,
      /summari[sz]e?\s+(?:it|so\s+far)?/i,
      /(?:our\s+)?(?:chat|conversation)\s+summar/i,
      /what\s+(?:were\s+we|did\s+we)\s+talking\s+about/i,
      /recap\s+(?:our\s+)?(?:conversation|chat)/i,
      /remind\s+me\s+what\s+we\s+discussed/i,
      /what\s+have\s+we\s+talked\s+about/i,
      /so\s+far\s+(?:what\s+)?(?:have\s+we|did\s+we)/i,
      /what\s+did\s+we\s+talk\s+about/i,
      /(?:can\s+you\s+)?(?:tell\s+me\s+)?what\s+we\s+(?:discussed|chatted|talked)/i
    ];
    if (conversationMetaPatterns.some(p => p.test(normalizedQuestion))) {
      const overview = await aiToolService.getConversationOverview(historyBeforeCurrentMessage);
      let response;
      if (overview) {
        const naturalized = await aiToolService.naturalizeConversationSummaryForUser(overview);
        response = `Here's what we've been up to so far:\n\n${naturalized}`;
      } else {
        response = await aiToolService.summarizeConversation(historyBeforeCurrentMessage, normalizedQuestion);
      }
      return {
        type: 'conversation_summary',
        response,
        confidence: 0.95,
        source: 'conversation_summary'
      };
    }

    // Step 1: Check FAQ vector search first for existing knowledge
    console.log('Checking FAQ vector search for:', normalizedQuestion);
    
    // Generate embedding for the question
    const questionEmbedding = await generateEmbedding(normalizedQuestion);
    
    // Find similar FAQs using vector similarity
    const allFAQs = await FaqVector.find({}).lean();
    
    if (allFAQs.length > 0) {
      // Calculate similarities and find best matches
      const similarities = allFAQs.map(faq => ({
        faq,
        similarity: cosineSimilarity(questionEmbedding, faq.embedding)
      }));
      
      // Sort by similarity (descending)
      similarities.sort((a, b) => b.similarity - a.similarity);
      
      // Get top matches above threshold
      const threshold = 0.7;
      const topMatches = similarities.filter(item => item.similarity >= threshold);
      
      if (topMatches.length > 0) {
        // Get the best match
        const bestMatch = topMatches[0];
        
        console.log(`FAQ match found with similarity: ${(bestMatch.similarity * 100).toFixed(1)}%`);
        
        // Use OpenAI to enhance the FAQ response
        try {
          const openaiResponse = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: [
              {
                role: 'system',
                content: `You are a helpful support assistant. 
Answer ONLY based on the stored FAQ knowledge base. 
If the question is unrelated or not found in the database, politely reply:
"Sorry, I don't have an answer for that."

Keep your response concise, helpful, and professional.`
              },
              {
                role: 'user',
                content: `Question: ${normalizedQuestion}

FAQ Knowledge Base:
Question: ${bestMatch.faq.question}
Answer: ${bestMatch.faq.answer}

Please provide a helpful response based on this FAQ knowledge.`
              }
            ],
            max_tokens: 300,
            temperature: 0.7
          });
          
          const enhancedAnswer = openaiResponse.choices[0]?.message?.content?.trim() || bestMatch.faq.answer;
          
          return {
            type: 'faq',
            response: enhancedAnswer,
            confidence: bestMatch.similarity,
            source: 'faq_vector_search',
            originalFAQ: {
              question: bestMatch.faq.question,
              answer: bestMatch.faq.answer
            },
            similarity: bestMatch.similarity,
            topMatches: topMatches.slice(0, 3).map(match => ({
              question: match.faq.question,
              answer: match.faq.answer,
              similarity: match.similarity
            }))
          };
          
        } catch (openaiError) {
          console.error('OpenAI enhancement failed:', openaiError);
          
          // Return original FAQ answer if OpenAI fails
          return {
            type: 'faq',
            response: bestMatch.faq.answer,
            confidence: bestMatch.similarity,
            source: 'faq_vector_search',
            originalFAQ: {
              question: bestMatch.faq.question,
              answer: bestMatch.faq.answer
            },
            similarity: bestMatch.similarity,
            fallback: true
          };
        }
      }
    }
    
    // Step 2: If no good FAQ match found, check if this is a capability question
    const capabilityPatterns = [
      /what\s+can\s+you\s+do/i,
      /what\s+are\s+your\s+capabilities/i,
      /what\s+are\s+your\s+use\s+cases/i,
      /how\s+can\s+you\s+help/i,
      /what\s+do\s+you\s+do/i,
      /tell\s+me\s+about\s+yourself/i
    ];
    
    const isCapabilityQuestion = capabilityPatterns.some(pattern => pattern.test(normalizedQuestion));
    
    if (isCapabilityQuestion) {
      console.log('Capability question detected, checking AI tool intent for:', normalizedQuestion);
      
    const aiIntent = await aiToolService.detectIntent(normalizedQuestion, contextForIntent);
    
      if (aiIntent && aiIntent.action === 'getCapabilities') {
        try {
          let aiResponse = await aiToolService.executeAITool(aiIntent, { sessionId });
          const isWizardPayload = aiResponse && typeof aiResponse === 'object' && aiResponse.html != null && aiResponse.orderWizardData != null;
          const responsePayload = isWizardPayload
            ? { response: aiResponse.html, orderWizardData: aiResponse.orderWizardData }
            : { response: typeof aiResponse === 'string' ? aiResponse : (aiResponse?.html ?? String(aiResponse)) };
          const out = { type: 'ai_tool', intent: aiIntent, ...responsePayload, confidence: aiIntent.confidence, source: 'ai_tool_service' };
          return await addNaturalReply(out, normalizedQuestion, { action: 'capabilities', summary: 'Here’s what I can help you with.' });
        } catch (aiError) {
          console.error('AI Tool execution failed:', aiError);
          // Continue to fallback response
        }
      }
    }
    
    // Step 3: If no good FAQ match and not a capability question, check AI tool intent for data/analytics requests
    console.log('No good FAQ match found, checking AI tool intent for:', normalizedQuestion);
    
    const aiIntent = await aiToolService.detectIntent(normalizedQuestion, contextForIntent);

    // Fallback: detectIntent returned null (e.g. conversation-meta PRE-CHECK); if message still looks like "what we discussed/summary", answer with full overview from start
    const conversationMetaLoose = /\b(?:what\s+we\s+discussed|summar(?:y|ies|ize)|our\s+chat|what\s+did\s+we\s+talk|what\s+have\s+we\s+chat|so\s+far)\b/i.test(normalizedQuestion);
    if (!aiIntent && conversationMetaLoose) {
      const overview = await aiToolService.getConversationOverview(historyBeforeCurrentMessage);
      let response;
      if (overview) {
        const naturalized = await aiToolService.naturalizeConversationSummaryForUser(overview);
        response = `Here's what we've been up to so far:\n\n${naturalized}`;
      } else {
        response = await aiToolService.summarizeConversation(historyBeforeCurrentMessage, normalizedQuestion);
      }
      return {
        type: 'conversation_summary',
        response,
        confidence: 0.95,
        source: 'conversation_summary'
      };
    }

    // Don't route "do you have anything in blue" / "anythin in 20-blue" (no "raw material" in message) to getRawMaterials — that's usually yarn/order context; raw materials need explicit "raw materials in blue"
    const looksLikeYarnColourQuestion = (/^(?:do\s+you\s+have\s+)(?:anything\s+in\s+|something\s+in\s+)[a-z0-9\s\-]+$|^(?:anything|something|anythin)\s+in\s+[a-z0-9\s\-]+$/i.test(normalizedQuestion.trim()) && !/\braw\s+material/i.test(normalizedQuestion) && normalizedQuestion.trim().length >= 8)
      || (aiIntent?.params?.color && !/\braw\s+material/i.test(normalizedQuestion) && /\b(?:anything|something|anythin)\s+in\s+/i.test(normalizedQuestion.trim()) && normalizedQuestion.trim().length >= 8);
    const storedFlowForYarn = sessionId ? aiToolService.getAgentFlowSession(sessionId) : null;
    const inPoFlowWithContext = (storedFlowForYarn?.flow === 'edit_po' && storedFlowForYarn?.context?.editOrderPo?.purchaseOrderId) || (storedFlowForYarn?.flow === 'create_po' && storedFlowForYarn?.context?.placeOrderContext);
    if (aiIntent?.action === 'getRawMaterials' && aiIntent?.params?.color && looksLikeYarnColourQuestion && !inPoFlowWithContext) {
      const out = {
        type: 'ai_tool',
        intent: { action: 'applyYarnPurchaseOrderEdit' },
        response: `If you're choosing a <strong>yarn</strong> to add to an order, say <strong>edit order PO-XXX</strong>, then <strong>add item</strong>, and ask e.g. "do you have anything in blue" — I'll show that supplier's yarns. For <strong>raw materials</strong> by colour, say "raw materials in blue".`,
        confidence: 0.9,
        source: 'faq_service'
      };
      return await addNaturalReply(out, normalizedQuestion, { action: 'clarify', summary: 'Clarifying yarn vs raw materials.' });
    }

    // "Remove item" with no intent (or lost context): if session says we're in edit_po, run edit flow so we show the item list to remove, not delete order
    const isRemoveItemPhrase = /^(?:remove|delete)\s+(?:an?\s+)?(?:item|line)\s*\.?$/i.test(normalizedQuestion.trim()) || /^(?:remove|delete)\s+items?\s*\.?$/i.test(normalizedQuestion.trim());
    if ((!aiIntent || aiIntent.action === 'getCapabilities') && isRemoveItemPhrase && storedFlowForYarn?.flow === 'edit_po' && storedFlowForYarn?.context?.editOrderPo?.purchaseOrderId) {
      try {
        const poId = storedFlowForYarn.context.editOrderPo.purchaseOrderId;
        const poNum = storedFlowForYarn.context.editOrderPo.poNumber;
        const result = await aiToolService.applyYarnPurchaseOrderEdit(poId, normalizedQuestion, storedFlowForYarn.context.editOrderPo);
        const responseStr = result.html || '';
        const resolvedPoNum = result.editOrderContext?.poNumber ?? poNum;
        const editSummary = (responseStr.includes('Remove item') && result.editOrderContext?.removeItemState?.step === 'choose_items') ? 'Pick item(s) to remove by number (e.g. 1 or 1, 3).' : 'Processed your order edit.';
        const out = {
          type: 'ai_tool',
          intent: { action: 'applyYarnPurchaseOrderEdit' },
          response: responseStr,
          confidence: 0.95,
          source: 'ai_tool_service',
          contextUsed: true,
          ...(result.editOrderContext !== undefined && { editOrderContext: result.editOrderContext })
        };
        persistAgentFlowIfNeeded(sessionId, out);
        return await addNaturalReply(out, normalizedQuestion, { action: 'edit order', summary: editSummary, poNumber: resolvedPoNum });
      } catch (err) {
        console.warn('Edit flow (remove item from session) failed:', err?.message);
      }
    }

    if (aiIntent && aiIntent.action !== 'getCapabilities') {
      console.log('AI Tool Intent Detected:', aiIntent);
      // Never treat a lone digit as a product: user was likely choosing supplier (1 or 2) after "which one do you mean?"
      if (aiIntent.action === 'getProductAnalysis' && /^\d+$/.test(normalizedQuestion.trim()) && Array.isArray(conversationHistory) && conversationHistory.length >= 2) {
        const lastAssistant = [...conversationHistory].reverse().find((m) => m.role === 'assistant');
        const lastContent = (lastAssistant?.content || '').toString();
        let prevUserForSafeguard = '';
        for (let i = conversationHistory.length - 1; i >= 0; i--) {
          if (conversationHistory[i].role === 'assistant') {
            for (let j = i - 1; j >= 0; j--) {
              if (conversationHistory[j].role === 'user') {
                prevUserForSafeguard = (conversationHistory[j].content || '').toString();
                break;
              }
            }
            break;
          }
        }
        const wasSupplierDisambiguation = /which one do you mean|reply with the number\s*\(e\.g\.\s*1 or 2\)|there are \d+ suppliers matching/i.test(lastContent) ||
          (/^\(Response with data\)$|^\(Response\)$/i.test(lastContent.trim()) && /\byarn\s+from\s+/i.test(prevUserForSafeguard));
        if (wasSupplierDisambiguation) {
          const out = {
            type: 'ai_tool',
            intent: { action: 'createYarnPurchaseOrder' },
            response: 'That number is for choosing a <strong>supplier</strong> from the list above (1 or 2). Please click one of the supplier buttons or type the supplier name to continue.',
            confidence: 0.9,
            source: 'faq_service'
          };
          return await addNaturalReply(out, normalizedQuestion, { action: 'clarify', summary: 'Use 1 or 2 to pick a supplier from the list.' });
        }
      }
      // When session says we're in a PO flow (edit or create), handle colour/keyword as yarn-in-PO flow — same as create PO; don't run getRawMaterials
      const storedFlow = storedFlowForYarn;
      const unrelatedToYarnFlow = (storedFlow?.flow === 'edit_po' || storedFlow?.flow === 'create_po') &&
        (aiIntent.action === 'getRawMaterials' || aiIntent.action === 'getRawMaterialColors');
      if (unrelatedToYarnFlow) {
        // Edit PO: run edit flow with user message so add-item keyword/colour search shows supplier yarns (like create PO)
        if (storedFlow?.flow === 'edit_po' && storedFlow.context?.editOrderPo?.purchaseOrderId) {
          try {
            const poId = storedFlow.context.editOrderPo.purchaseOrderId;
            const poNum = storedFlow.context.editOrderPo.poNumber;
            const result = await aiToolService.applyYarnPurchaseOrderEdit(poId, normalizedQuestion, storedFlow.context.editOrderPo);
            const responseStr = result.html || '';
            const resolvedPoNum = result.editOrderContext?.poNumber ?? poNum;
            let editSummary = 'Processed your order edit.';
            if (responseStr && typeof responseStr === 'string') {
              if (responseStr.includes('Quantity Updated')) editSummary = 'Updated the quantity.';
              else if (responseStr.includes('Here are yarn items from') && result.editOrderContext?.addItemState) editSummary = 'Showing yarn list to add to order. Pick a yarn by number or name.';
              else if (responseStr.includes('No yarn found') || responseStr.includes('No match')) editSummary = 'No matching yarn. Try a different keyword or pick from the list.';
            }
            const out = {
              type: 'ai_tool',
              intent: { action: 'applyYarnPurchaseOrderEdit' },
              response: responseStr,
              confidence: 0.95,
              source: 'ai_tool_service',
              contextUsed: true,
              ...(result.editOrderContext !== undefined && { editOrderContext: result.editOrderContext })
            };
            persistAgentFlowIfNeeded(sessionId, out);
            return await addNaturalReply(out, normalizedQuestion, { action: 'edit order', summary: editSummary, poNumber: resolvedPoNum });
          } catch (err) {
            console.warn('Edit PO flow (from session) failed:', err?.message);
          }
        }
        // Create PO: run place-order chat with user message so keyword/colour search shows supplier yarns
        if (storedFlow?.flow === 'create_po' && storedFlow.context?.placeOrderContext) {
          try {
            const result = await aiToolService.handlePlaceOrderYarnChat(storedFlow.context.placeOrderContext, normalizedQuestion);
            if (result?.html != null) {
              const out = {
                type: 'ai_tool',
                intent: { action: 'createYarnPurchaseOrder' },
                response: result.html,
                orderWizardPrompt: result.orderWizardPrompt ?? undefined,
                ...(result.placeOrderContext != null && { placeOrderContext: result.placeOrderContext }),
                confidence: 0.95,
                source: 'ai_tool_service',
                contextUsed: true
              };
              persistAgentFlowIfNeeded(sessionId, out);
              const summary = (result.summary || '').includes('No match') ? 'No matching yarn. Try a different keyword or pick from the list.' : (result.summary || 'Processing.');
              return await addNaturalReply(out, normalizedQuestion, { action: 'place order (chat)', summary });
            }
          } catch (err) {
            console.warn('Create PO flow (from session) failed:', err?.message);
          }
        }
        // No stored context: keep user in flow with a short hint
        const out = {
          type: 'ai_tool',
          intent: { action: storedFlow?.flow === 'edit_po' ? 'applyYarnPurchaseOrderEdit' : 'createYarnPurchaseOrder' },
          response: `You're in the <strong>${storedFlow?.flow === 'edit_po' ? 'edit order' : 'place order'}</strong> flow. Reply with a yarn choice (number, name, or keyword like "blue"), or say <strong>done</strong> to finish. For raw materials, start a new message with "raw materials in [colour]".`,
          confidence: 0.9,
          source: 'faq_service'
        };
        return await addNaturalReply(out, normalizedQuestion, { action: 'stay in flow', summary: 'Staying in current flow.' });
      }

      try {
        // Execute AI tool and return HTML response (sessionId enables confirmation guardrails for update/delete)
        let aiResponse = await aiToolService.executeAITool(aiIntent, { sessionId });
        // Normalize: createYarnPurchaseOrder can return wizard data, choose_supplier, choose_yarn_for_supplier, or disambiguate_supplier
        const isWizardPayload = aiResponse && typeof aiResponse === 'object' && aiResponse.html != null && aiResponse.orderWizardData != null;
        const isPromptPayload = aiResponse && typeof aiResponse === 'object' && aiResponse.html != null && aiResponse.orderWizardPrompt != null;
        const responsePayload = isWizardPayload
          ? { response: aiResponse.html, orderWizardData: aiResponse.orderWizardData }
          : isPromptPayload
            ? {
                response: aiResponse.html,
                orderWizardPrompt: aiResponse.orderWizardPrompt,
                ...(aiResponse.preSelectedSupplier != null && { preSelectedSupplier: aiResponse.preSelectedSupplier }),
                ...(aiResponse.matchingSuppliers != null && { matchingSuppliers: aiResponse.matchingSuppliers })
              }
            : { response: typeof aiResponse === 'string' ? aiResponse : (aiResponse?.html ?? String(aiResponse)) };
        // Include editOrderContext etc. so frontend can persist them (e.g. "edit PO-2026-975" → next "add item" stays in edit flow with order's supplier)
        const contextPayload = {
          ...(aiResponse?.editOrderContext !== undefined && { editOrderContext: aiResponse.editOrderContext }),
          ...(aiResponse?.awaitingFollowUp != null && { awaitingFollowUp: aiResponse.awaitingFollowUp }),
          ...(aiResponse?.orderRefForStatus && { orderRefForStatus: aiResponse.orderRefForStatus }),
          ...(aiResponse?.placeOrderContext != null && { placeOrderContext: aiResponse.placeOrderContext }),
          ...(aiResponse?.salesDataPagination != null && { salesDataPagination: aiResponse.salesDataPagination })
        };
        const out = { type: 'ai_tool', intent: aiIntent, ...responsePayload, ...contextPayload, confidence: aiIntent.confidence, source: 'ai_tool_service' };
        persistAgentFlowIfNeeded(sessionId, out);
        const summary = aiIntent.description || 'Retrieved the requested information.';
        return await addNaturalReply(out, normalizedQuestion, {
          action: aiIntent.action,
          summary,
          poNumber: aiIntent.params?.poNumber,
          dataDrivenMessage: aiResponse?.dataDrivenMessage
        });
      } catch (aiError) {
        console.error('AI Tool execution failed:', aiError);
        // Continue to fallback response
      }
    }

    // Step 4: Final fallback - no FAQ match and no AI tool
    if (allFAQs.length === 0) {
      if (!aiIntent) {
        console.log('No intent detected, returning global disambiguation');
        return getGlobalDisambiguationResponse();
      }
      // Use conversation service for natural conversation handling
      console.log('No FAQ knowledge, using conversation service for:', normalizedQuestion);
      try {
        const conversationResponse = await conversationService.processNaturalConversation(question, 'faq-session');
        
        // Convert conversation service response to FAQ service format
        if (conversationResponse.type === 'data_response') {
          return {
            type: 'ai_tool',
            intent: conversationResponse.intent,
            response: conversationResponse.dataHtml,
            conversationalMessage: conversationResponse.conversationalMessage,
            confidence: 0.9,
            source: 'conversation_service'
          };
        } else if (conversationResponse.type === 'clarification') {
          return {
            type: 'faq',
            response: conversationResponse.message,
            suggestions: conversationResponse.options || conversationResponse.suggestions,
            confidence: 0.8,
            source: 'conversation_service',
            clarification: true
          };
        } else {
          return {
            type: 'faq',
            response: conversationResponse.message,
            suggestions: conversationResponse.suggestions,
            confidence: 0.8,
            source: 'conversation_service'
          };
        }
      } catch (convError) {
        console.error('Conversation service error:', convError);
        return {
          type: 'faq',
          response: "I don't have any FAQ knowledge yet. Please train me with some questions and answers first.",
          confidence: 0,
          source: 'faq_vector_search',
          fallback: true
        };
      }
    } else {
      // Step 5: Use conversation service for queries not covered by FAQ or AI tools
      if (!aiIntent) {
        console.log('No intent detected, returning global disambiguation');
        return getGlobalDisambiguationResponse();
      }
      console.log('No FAQ or AI tool match found, using conversation service for:', normalizedQuestion);
      
      try {
        const conversationResponse = await conversationService.processNaturalConversation(question, 'faq-session');
        
        // Convert conversation service response to FAQ service format
        if (conversationResponse.type === 'data_response') {
          return {
            type: 'ai_tool',
            intent: conversationResponse.intent,
            response: conversationResponse.dataHtml,
            conversationalMessage: conversationResponse.conversationalMessage,
            confidence: 0.9,
            source: 'conversation_service'
          };
        } else if (conversationResponse.type === 'clarification') {
          return {
            type: 'faq',
            response: conversationResponse.message,
            suggestions: conversationResponse.options || conversationResponse.suggestions,
            confidence: 0.8,
            source: 'conversation_service',
            clarification: true
          };
        } else {
          return {
            type: 'faq',
            response: conversationResponse.message,
            suggestions: conversationResponse.suggestions,
            confidence: 0.8,
            source: 'conversation_service'
          };
        }
      } catch (convError) {
        console.error('Conversation service error:', convError);
        // Final fallback if conversation service fails
        return {
          type: 'faq',
          response: "I apologize, but I'm having trouble processing your question right now. Could you please rephrase it or try asking about sales data, products, stores, yarn management, or production?",
          confidence: 0.5,
          source: 'faq_fallback',
          suggestions: [
            "Show me top products",
            "Show me sales data",
            "Show me yarn inventory",
            "Show me stores"
          ]
        };
      }
    }
  } catch (error) {
    console.error('FAQ service error:', error);
    throw error;
  }
};

/**
 * Get all FAQs with pagination
 * @param {Object} options - Query options
 * @returns {Promise<Object>} - Paginated FAQ results
 */
export const getAllFAQs = async (options = {}) => {
  try {
    const { page = 1, limit = 10, search } = options;
    
    let filter = {};
    if (search) {
      filter.$or = [
        { question: { $regex: search, $options: 'i' } },
        { answer: { $regex: search, $options: 'i' } }
      ];
    }
    
    const skip = (page - 1) * limit;
    
    const [faqs, total] = await Promise.all([
      FaqVector.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('-embedding')
        .lean(),
      FaqVector.countDocuments(filter)
    ]);
    
    return {
      faqs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1
      }
    };
  } catch (error) {
    throw new ApiError(500, `Failed to get FAQs: ${error.message}`);
  }
};

/**
 * Delete FAQ by ID
 * @param {string} faqId - FAQ ID
 * @returns {Promise<Object>} - Deletion result
 */
export const deleteFAQ = async (faqId) => {
  try {
    const deletedFaq = await FaqVector.findByIdAndDelete(faqId);
    if (!deletedFaq) {
      throw new ApiError(404, 'FAQ not found');
    }
    return {
      message: 'FAQ deleted successfully',
      faq: deletedFaq
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, `Failed to delete FAQ: ${error.message}`);
  }
};

/**
 * Update FAQ by ID
 * @param {string} faqId - FAQ ID
 * @param {Object} updateData - Update data
 * @returns {Promise<Object>} - Updated FAQ
 */
export const updateFAQ = async (faqId, updateData) => {
  try {
    const updatedFaq = await FaqVector.findByIdAndUpdate(faqId, updateData, { new: true });
    if (!updatedFaq) {
      throw new ApiError(404, 'FAQ not found');
    }
    return updatedFaq;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, `Failed to update FAQ: ${error.message}`);
  }
};

/**
 * Get FAQ statistics
 * @returns {Promise<Object>} - FAQ statistics
 */
export const getFAQStats = async () => {
  try {
    const total = await FaqVector.countDocuments();
    return {
      total,
      message: `Total FAQs: ${total}`
    };
  } catch (error) {
    throw new ApiError(500, `Failed to get FAQ stats: ${error.message}`);
  }
};

/**
 * Get all FAQ vectors with pagination
 * @param {Object} filter - Filter criteria
 * @param {Object} options - Pagination and sorting options
 * @returns {Promise<Object>} - Paginated FAQ results
 */
export const getFaqVectors = async (filter = {}, options = {}) => {
  try {
    const { page = 1, limit = 10, sortBy = 'createdAt' } = options;
    
    const skip = (page - 1) * limit;
    
    const [faqs, totalResults] = await Promise.all([
      FaqVector.find(filter)
        .sort({ [sortBy]: -1 })
        .skip(skip)
        .limit(limit)
        .select('-embedding')
        .lean(),
      FaqVector.countDocuments(filter)
    ]);
    
    const totalPages = Math.ceil(totalResults / limit);
    
    return {
      results: faqs,
      page,
      limit,
      totalPages,
      totalResults,
      hasNext: page < totalPages,
      hasPrev: page > 1
    };
  } catch (error) {
    throw new ApiError(500, `Failed to get FAQ vectors: ${error.message}`);
  }
};

/**
 * Delete FAQ vector by ID
 * @param {string} faqId - FAQ ID
 * @returns {Promise<Object>} - Deletion result
 */
export const deleteFaqVector = async (faqId) => {
  try {
    const deletedFaq = await FaqVector.findByIdAndDelete(faqId);
    if (!deletedFaq) {
      throw new ApiError(404, 'FAQ not found');
    }
    return {
      message: 'FAQ deleted successfully',
      faq: deletedFaq
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, `Failed to delete FAQ vector: ${error.message}`);
  }
};

/**
 * Clear all FAQ vectors
 * @returns {Promise<Object>} - Clear result
 */
export const clearAllFaqs = async () => {
  try {
    const result = await FaqVector.deleteMany({});
    
    return {
      message: 'All FAQ vectors cleared successfully',
      deletedCount: result.deletedCount
    };
  } catch (error) {
    throw new ApiError(500, `Failed to clear FAQ vectors: ${error.message}`);
  }
};

export default {
  trainFAQ,
  bulkTrainFAQ,
  askQuestion,
  getAllFAQs,
  deleteFAQ,
  updateFAQ,
  getFAQStats,
  getFaqVectors,
  deleteFaqVector,
  clearAllFaqs,
  appendUserMessageToSession,
  getSessionConversationHistory,
  persistSessionConversationFromResponse,
  endSession
};
