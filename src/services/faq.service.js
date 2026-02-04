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

const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

/**
 * Add a natural-language agent reply so the chat feels conversational. Mutates and returns the same object.
 * @param {Object} returnObj - The response object to add conversationalMessage to
 * @param {string} userMessage - What the user said
 * @param {Object} opts - { action: string, summary: string, poNumber?: string }
 * @returns {Promise<Object>} Same returnObj with conversationalMessage if GPT replied
 */
const addNaturalReply = async (returnObj, userMessage, opts = {}) => {
  try {
    const msg = await aiToolService.generateNaturalAgentReply(userMessage, opts);
    if (msg) returnObj.conversationalMessage = msg;
  } catch (e) {
    // non-blocking: keep existing response
  }
  return returnObj;
};

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
    
    const normalizedQuestion = question.trim();
    if (normalizedQuestion.length === 0) {
      throw new ApiError(400, 'Question cannot be empty');
    }

    const { sessionId, context, conversationHistory } = options;

    // In-chat edit: when we're editing an order (context.editOrderPo) and user sends an edit instruction, apply it
    if (context?.editOrderPo?.purchaseOrderId) {
      try {
        const result = await aiToolService.applyYarnPurchaseOrderEdit(
          context.editOrderPo.purchaseOrderId,
          normalizedQuestion,
          context.editOrderPo
        );
        const responseStr = result.html || '';
        const poNum = context.editOrderPo.poNumber || result.editOrderContext?.poNumber;
        let editSummary = 'Processed your order edit.';
        if (responseStr && typeof responseStr === 'string') {
          if (responseStr.includes('Quantity Updated')) editSummary = 'Updated the quantity.';
          else if (responseStr.includes('Status Updated')) editSummary = 'Updated the order status.';
          else if (responseStr.includes('Change quantity')) editSummary = 'Helping you change the quantity.';
          else if (responseStr.includes('Item Removed')) editSummary = 'Removed the item.';
          else if (responseStr.includes('Item Added')) editSummary = 'Added the item.';
          else if (responseStr.includes('Order Complete') || responseStr.includes('Edit Cancelled')) editSummary = 'Finished with the order edit.';
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
        return await addNaturalReply(out, normalizedQuestion, { action: 'edit order', summary: editSummary, poNumber: poNum });
      } catch (err) {
        console.warn('Apply edit failed:', err?.message);
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
        const result = await aiToolService.handlePlaceOrderYarnChat(context.placeOrderContext, normalizedQuestion);
        if (result.needsPlaceOrderConfirmation && sessionId && result.placeOrderContext) {
          aiToolService.setPendingPlaceOrderConfirmation(sessionId, { placeOrderContext: result.placeOrderContext });
          const out = {
            type: 'ai_tool',
            intent: { action: 'createYarnPurchaseOrder' },
            response: result.html,
            orderWizardPrompt: undefined,
            placeOrderContext: undefined,
            confidence: 0.95,
            source: 'ai_tool_service',
            contextUsed: true
          };
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
            const responsePayload = isPromptPayload ? { response: aiResponse.html, orderWizardPrompt: aiResponse.orderWizardPrompt } : { response: typeof aiResponse === 'string' ? aiResponse : (aiResponse?.html ?? String(aiResponse)) };
            const out = { type: 'ai_tool', intent: { action: 'createYarnPurchaseOrder', params: {} }, ...responsePayload, confidence: 0.95, source: 'ai_tool_service', contextUsed: true };
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
              orderWizardPrompt: aiResponse.orderWizardPrompt
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

    // Resolve pending confirmation first when session has a pending action (yes/no/y/n/confirm/cancel or re-prompt)
    if (sessionId) {
      const resolved = await aiToolService.resolvePendingConfirmation(sessionId, normalizedQuestion);
      if (resolved.resolved && resolved.response != null) {
        const out = {
          type: 'ai_tool',
          intent: { action: 'confirm_or_cancel' },
          response: resolved.response,
          confidence: 1,
          source: 'ai_tool_service',
          confirmationResolved: true
        };
        const summary = resolved.poNumber ? `Order placed with PO number ${resolved.poNumber}.` : 'Done.';
        return await addNaturalReply(out, normalizedQuestion, { action: 'confirm action', summary });
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
    
    // Run order-action intent (delete/update status/edit order) before FAQ so they are never overridden by FAQ match
    const orderActionPattern = /\b(delete|cancel|remove|update|mark|set|edit)\b.*\b(?:purchase\s+)?order\b|edit\s+order/i;
    if (orderActionPattern.test(normalizedQuestion)) {
      const orderIntent = await aiToolService.detectIntent(normalizedQuestion, { conversationHistory });
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
          return await addNaturalReply(out, normalizedQuestion, { action: actionLabel, summary, poNumber: orderIntent.params?.poNumber });
        } catch (orderErr) {
          console.warn('Order action execution failed, continuing to FAQ:', orderErr?.message);
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
      
    const aiIntent = await aiToolService.detectIntent(normalizedQuestion, { conversationHistory });
    
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
    
    const aiIntent = await aiToolService.detectIntent(normalizedQuestion, { conversationHistory });
    
    if (aiIntent && aiIntent.action !== 'getCapabilities') {
      console.log('AI Tool Intent Detected:', aiIntent);
      
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
        const out = { type: 'ai_tool', intent: aiIntent, ...responsePayload, confidence: aiIntent.confidence, source: 'ai_tool_service' };
        const summary = aiIntent.description || 'Retrieved the requested information.';
        return await addNaturalReply(out, normalizedQuestion, { action: aiIntent.action, summary, poNumber: aiIntent.params?.poNumber });
      } catch (aiError) {
        console.error('AI Tool execution failed:', aiError);
        // Continue to fallback response
      }
    }
    
    // Step 4: Final fallback - no FAQ match and no AI tool
    if (allFAQs.length === 0) {
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
  clearAllFaqs
};
