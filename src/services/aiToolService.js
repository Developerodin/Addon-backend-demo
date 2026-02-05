import * as analyticsService from './analytics.service.js';
import * as productService from './product.service.js';
import * as storeService from './store.service.js';
import * as salesService from './sales.service.js';
import * as replenishmentService from './replenishment.service.js';
import * as categoryService from './category.service.js';
import Sales from '../models/sales.model.js';
import Store from '../models/store.model.js';
import Product from '../models/product.model.js';
import { OpenAI } from 'openai';
import config from '../config/config.js';
import * as dashboardService from './dashboard.service.js'; // Added missing import
// Extended imports for yarn, machine, production, and order data
import * as machineService from './machine.service.js';
import * as yarnCatalogService from './yarnManagement/yarnCatalog.service.js';
import * as yarnInventoryService from './yarnManagement/yarnInventory.service.js';
import * as yarnTransactionService from './yarnManagement/yarnTransaction.service.js';
import * as yarnReqService from './yarnManagement/yarnReq.service.js';
import * as yarnPurchaseOrderService from './yarnManagement/yarnPurchaseOrder.service.js';
import * as yarnTypeService from './yarnManagement/yarnType.service.js';
import * as supplierService from './yarnManagement/supplier.service.js';
import * as countSizeService from './yarnManagement/countSize.service.js';
import * as colorService from './yarnManagement/color.service.js';
import * as blendService from './yarnManagement/blend.service.js';
import * as rawMaterialService from './rawMaterial.service.js';
import * as processService from './process.service.js';
import * as productAttributeService from './productAttribute.service.js';
import * as productionService from './production/order.service.js';
import * as orderService from './order.service.js';
import * as yarnBoxService from './yarnManagement/yarnBox.service.js';
import * as yarnConeService from './yarnManagement/yarnCone.service.js';
import * as storageSlotService from './storageManagement/storageSlot.service.js';
import Machine from '../models/machine.model.js';
import { Article, ProductionOrder } from '../models/production/index.js';
import * as agentUiFlowService from './agent/agentUiFlow.service.js';

const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

/**
 * Levenshtein (edit) distance between two strings — for typo tolerance and "did you mean" suggestions.
 */
const levenshtein = (a, b) => {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
};

/**
 * Find nearest supplier(s) by typo-tolerant word matching (for "did you mean" when no exact match).
 * @param {string} query - User input (e.g. "wampum priviate limited")
 * @param {Array<{brandName?: string, name?: string, _id?: string, id?: string}>} suppliers - All suppliers
 * @param {{ maxTotalEditDistance?: number, maxPerWord?: number }} options
 * @returns {{ best: { id: string, brandName: string }, score: number } | null}
 */
const findNearestSupplierByTypo = (query, suppliers, options = {}) => {
  const maxTotalEditDistance = options.maxTotalEditDistance ?? 6;
  const maxPerWord = options.maxPerWord ?? 2;
  const queryWords = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!queryWords.length || !suppliers?.length) return null;

  let best = null;
  let bestScore = Infinity;

  for (const s of suppliers) {
    const name = (s.brandName || s.name || '').trim();
    if (!name) continue;
    const nameWords = name.toLowerCase().split(/\s+/).filter(Boolean);
    let totalScore = 0;
    for (const qw of queryWords) {
      let minDist = Infinity;
      for (const nw of nameWords) {
        const d = levenshtein(qw, nw);
        if (d < minDist) minDist = d;
      }
      if (minDist > maxPerWord) {
        totalScore = Infinity;
        break;
      }
      totalScore += minDist;
    }
    if (totalScore < bestScore && totalScore <= maxTotalEditDistance) {
      bestScore = totalScore;
      best = {
        id: (s._id || s.id)?.toString?.() || '',
        brandName: name
      };
    }
  }
  return best ? { best, score: bestScore } : null;
};

/**
 * Generate pagination HTML helper
 * @param {number} currentPage - Current page number
 * @param {number} totalPages - Total number of pages
 * @param {number} totalCount - Total number of items
 * @param {string} categoryName - Name of the category (e.g., "storage slots", "products")
 * @returns {string} HTML string with pagination controls
 */
const generatePaginationHTML = (currentPage, totalPages, totalCount, categoryName) => {
  if (totalPages <= 1) return '';
  
  const prevPage = currentPage > 1 ? currentPage - 1 : null;
  const nextPage = currentPage < totalPages ? currentPage + 1 : null;
  
  // Create page buttons (show up to 5 pages around current page)
  const pageButtons = [];
  const startPage = Math.max(1, currentPage - 2);
  const endPage = Math.min(totalPages, currentPage + 2);
  
  if (startPage > 1) {
    pageButtons.push({ page: 1, label: '1' });
    if (startPage > 2) {
      pageButtons.push({ page: null, label: '...' });
    }
  }
  
  for (let i = startPage; i <= endPage; i++) {
    pageButtons.push({ page: i, label: i.toString() });
  }
  
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      pageButtons.push({ page: null, label: '...' });
    }
    pageButtons.push({ page: totalPages, label: totalPages.toString() });
  }
  
  // Generate unique ID for this pagination container
  const paginationId = `pagination-${categoryName}-${currentPage}-${Date.now()}`;
  
  return `
    <div class="pagination-container" data-pagination-id="${paginationId}" style="margin-top: 20px; padding: 15px; background: #fff; border-radius: 12px; text-align: center; border: 1px solid #e5e7eb;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 15px;">
        <div style="flex: 1; text-align: left;">
          ${prevPage ? `
            <button 
              class="pagination-btn pagination-prev" 
              data-category="${categoryName}" 
              data-page="${prevPage}"
              style="padding: 8px 16px; background: #3b82f6; color: #fff; border: none; border-radius: 8px; cursor: pointer; font-weight: 500; transition: all 0.2s ease;"
              onmouseover="this.style.opacity='0.9';"
              onmouseout="this.style.opacity='1';"
            >
              ← Previous Page
            </button>
          ` : `
            <span style="color: #6b7280; padding: 8px 16px;">No previous page</span>
          `}
        </div>
        <div style="flex: 1; text-align: center;">
          <strong style="color: #000; font-size: 1.1em;">Page ${currentPage} of ${totalPages}</strong>
          <br><span style="color: #6b7280; font-size: 0.9em;">(${totalCount.toLocaleString()} total items)</span>
        </div>
        <div style="flex: 1; text-align: right;">
          ${nextPage ? `
            <button 
              class="pagination-btn pagination-next" 
              data-category="${categoryName}" 
              data-page="${nextPage}"
              style="padding: 8px 16px; background: #3b82f6; color: #fff; border: none; border-radius: 8px; cursor: pointer; font-weight: 500; transition: all 0.2s ease;"
              onmouseover="this.style.opacity='0.9';"
              onmouseout="this.style.opacity='1';"
            >
              Next Page →
            </button>
          ` : `
            <span style="color: #6b7280; padding: 8px 16px;">No next page</span>
          `}
        </div>
      </div>
      
      <!-- Page Number Buttons -->
      <div style="display: flex; justify-content: center; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 15px;">
        ${pageButtons.map(btn => {
          if (btn.page === null) {
            return `<span style="color: #6b7280; padding: 8px;">${btn.label}</span>`;
          }
          const isCurrent = btn.page === currentPage;
          return `
            <button 
              class="pagination-btn pagination-page" 
              data-category="${categoryName}" 
              data-page="${btn.page}"
              style="
                padding: 8px 14px; 
                background: ${isCurrent ? '#10b981' : '#f3f4f6'}; 
                color: ${isCurrent ? '#fff' : '#000'}; 
                border: ${isCurrent ? 'none' : '1px solid #e5e7eb'}; 
                border-radius: 8px; 
                cursor: ${isCurrent ? 'default' : 'pointer'}; 
                font-weight: ${isCurrent ? '600' : '500'}; 
                transition: all 0.2s ease;
              "
              ${!isCurrent ? `onmouseover="this.style.background='#e5e7eb';"` : ''}
              ${!isCurrent ? `onmouseout="this.style.background='#f3f4f6';"` : ''}
              ${isCurrent ? 'disabled' : ''}
            >
              ${btn.label}
            </button>
          `;
        }).join('')}
      </div>
      
      <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #e5e7eb;">
        <p style="margin: 0; color: #6b7280; font-size: 0.9em;">
          💡 <strong style="color: #000;">Tip:</strong> Click the buttons above to navigate, or ask me: 
          ${prevPage ? `"Show ${categoryName} page ${prevPage}"` : ''} 
          ${prevPage && nextPage ? ' or ' : ''} 
          ${nextPage ? `"Show ${categoryName} page ${nextPage}"` : ''}
          ${totalPages > 2 ? ` or any page from 1 to ${totalPages}` : ''}
        </p>
      </div>
      
      <script>
        (function() {
          // Initialize global pagination handler if it doesn't exist
          if (!window.paginationHandler) {
            window.paginationHandler = {
              isProcessing: false,
              lastClickTime: 0,
              lastCategory: null,
              lastPage: null,
              globalListenerAttached: false
            };
            
            // Attach a single global listener to document body for all pagination clicks
            // This prevents multiple listeners from being attached and works with frontend's event system
            if (!window.paginationHandler.globalListenerAttached) {
              window.paginationHandler.globalListenerAttached = true;
              
              document.body.addEventListener('click', function(e) {
                const button = e.target.closest('.pagination-btn');
                if (!button || button.disabled) {
                  return;
                }
                
                const category = button.getAttribute('data-category');
                const page = button.getAttribute('data-page');
                
                if (!category || !page) {
                  return;
                }
                
                // Global debounce: prevent rapid clicks
                const now = Date.now();
                const timeSinceLastClick = now - window.paginationHandler.lastClickTime;
                const isSameRequest = window.paginationHandler.lastCategory === category && 
                                      window.paginationHandler.lastPage === page;
                
                // If same request within 2 seconds, ignore it
                if (isSameRequest && timeSinceLastClick < 2000) {
                  e.preventDefault();
                  e.stopPropagation();
                  return;
                }
                
                // If already processing any pagination click, ignore
                if (window.paginationHandler.isProcessing) {
                  e.preventDefault();
                  e.stopPropagation();
                  return;
                }
                
                // Mark as processing
                window.paginationHandler.isProcessing = true;
                window.paginationHandler.lastClickTime = now;
                window.paginationHandler.lastCategory = category;
                window.paginationHandler.lastPage = page;
                
                // Prevent default and stop propagation to avoid duplicate handlers
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                
                // Dispatch the custom event that the frontend expects
                const paginationEvent = new CustomEvent('paginationNavigate', {
                  detail: { category, page },
                  bubbles: true,
                  cancelable: true
                });
                document.dispatchEvent(paginationEvent);
                
                // Reset processing flag after a delay
                setTimeout(() => {
                  window.paginationHandler.isProcessing = false;
                }, 2000);
              }, true); // Use capture phase to catch early
            }
          }
        })();
      </script>
    </div>
  `;
};

/**
 * Use OpenAI to intelligently detect intent and extract parameters
 * @param {string} question - User's question
 * @param {Array<{role: string, content: string}>} [conversationHistory] - Recent chat turns for context (like GPT)
 * @returns {Promise<Object|null>} Intent object or null if no match
 */
const detectIntentWithAI = async (question, conversationHistory = []) => {
  try {
    const historyMessages = (Array.isArray(conversationHistory) ? conversationHistory : [])
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map((m) => ({ role: m.role, content: String(m.content).slice(0, 2000) }))
      .slice(-20);
    const messages = [
      {
        role: 'system',
        content: `You are an AI assistant that analyzes retail business queries and determines the user's intent. 
          
          Analyze the user's question and return a JSON object with the following structure:
          {
            "action": "one of: getProductForecast, getProductAnalysis, getStoreAnalysisByName, getTopProducts, getProductCount, getProductsList, getStoresList, getSalesReport, getSalesData, getAnalyticsDashboard, getBrandPerformance, getCapabilities, getMachineStatistics, getMachinesByStatus, getMachinesByFloor, getYarnCatalog, getYarnInventory, getLiveInventory, getRecentPOStatus, getYarnTransactions, getYarnRequisitions, getYarnPurchaseOrders, getYarnPurchaseOrderById, createYarnPurchaseOrder, editYarnPurchaseOrder, updateYarnPurchaseOrderStatus, deleteYarnPurchaseOrder, getYarnIssue, getYarnReturn, getYarnTypes, getYarnSuppliers, getYarnCountSizes, getYarnColors, getYarnBlends, getRawMaterials, getProcesses, getProductAttributes, getProductionOrders, getProductionDashboard, getOrders",
            "params": {
              // Common filters
              "limit": "extracted number limit or null",
              "page": "extracted page number (e.g., 'page 2', 'page 3') or null",
              "status": "extracted status (active, inactive, true, false) or null",
              
              // Product filters
              "productName": "extracted product name or null",
              "category": "extracted category name or null",
              
              // Store filters
              "city": "extracted city name or null", 
              "storeName": "extracted store name or null",
              "storeId": "extracted store ID or null",
              "bpCode": "extracted BP code or null",
              "brand": "extracted brand name or null",
              "state": "extracted state name or null",
              "pincode": "extracted pincode or null",
              
              // Sales filters
              "period": "extracted time period or null",
              "dateFrom": "extracted start date or null",
              "dateTo": "extracted end date or null",
              "mrpMin": "extracted minimum MRP (e.g. when user says mrp above 299, price above 299) or null",
              "mrpMax": "extracted maximum MRP (e.g. when user says mrp below 500) or null",
              
              // Machine filters
              "machineStatus": "extracted machine status (Active, Under Maintenance, Idle) or null",
              "floor": "extracted floor name or null",
              "machineCode": "extracted machine code or null",
              "machineNumber": "extracted machine number or null",
              "needleSize": "extracted needle size or null",
              "model": "extracted machine model or null",
              
              // Yarn Type filters
              "yarnType": "extracted yarn type name or null",
              "yarnTypeName": "extracted yarn type name or null",
              "yarnTypeDetails": "extracted yarn type details/subtype or null",
              "yarnSubtype": "extracted yarn subtype or null",
              
              // Yarn Catalog filters
              "yarnName": "extracted yarn name or null",
              "yarnId": "extracted yarn ID or null",
              "countSize": "extracted count size or null",
              "blend": "extracted blend name or null",
              "colorFamily": "extracted color family or null",
              "pantonShade": "extracted pantone shade or null",
              "pantonName": "extracted pantone name or null",
              "season": "extracted season or null",
              "hsnCode": "extracted HSN code or null",
              
              // Yarn Inventory filters
              "inventoryStatus": "extracted inventory status (in_stock, low_stock, soon_to_be_low) or null",
              
              // Yarn Transaction filters
              "transactionType": "extracted transaction type (yarn_issued, yarn_blocked, yarn_stocked, internal_transfer, yarn_returned) or null",
              "transactionDate": "extracted transaction date or null",
              "yarnId": "extracted yarn ID for yarn transactions filtering or null",
              "yarnName": "extracted yarn name for yarn transactions filtering or null",
              "orderno": "extracted order number for yarn transactions filtering or null",
              "dateFrom": "extracted start date for yarn transactions filtering or null",
              "dateTo": "extracted end date for yarn transactions filtering or null",
              
              // Yarn Purchase Order filters
              "poNumber": "extracted PO number or null",
              "purchaseOrderId": "extracted purchase order Mongo ID or null",
              "supplierName": "extracted supplier name or null",
              "currentStatus": "extracted PO status (submitted_to_supplier, in_transit, goods_received, qc_pending, po_rejected, po_accepted) or null",
              "status_code": "extracted new status when updating order (e.g. in transit, goods received) or null",
              "poItems": "array of { yarnName, quantity, rate, sizeCount?, shadeCode?, gstRate? } when placing new order or null",
              
              // Raw Material filters
              "groupName": "extracted group name for raw materials filtering or null",
              "type": "extracted type for raw materials filtering or null",
              "material": "extracted material name for raw materials filtering or null",
              "color": "extracted color for raw materials filtering or null",
              "shade": "extracted shade for raw materials filtering or null",
              "unit": "extracted unit for raw materials filtering or null",
              "name": "extracted name for raw materials filtering or null",
              "mrp": "extracted MRP for raw materials filtering or null",
              "articleNo": "extracted article number for raw materials filtering or null",
              
              // Process filters
              "processName": "extracted process name or null",
              "processType": "extracted process type or null",
              
              // Product Attribute filters
              "attributeName": "extracted attribute name or null",
              "attributeType": "extracted attribute type (select, radio, checkbox, text, textarea) or null",
              
              // Order filters
              "orderId": "extracted order ID or null",
              "orderNumber": "extracted order number or null"
            },
            "description": "brief description of what the user wants",
            "confidence": 0.9
          }
          
          Rules:
          - For yarn catalog: action = "getYarnCatalog" if asking about yarn catalog/list/types
          - For yarn catalog pagination: action = "getYarnCatalog", extract page parameter (e.g., "yarn catalog page 2", "page 3 yarn catalog", "show yarn catalog page 2")
          - CRITICAL: When user says "Show yarn catalog page 2" or "yarn catalog page 2", extract page=2 in params
          - CRITICAL: Always extract the page number when it appears after "page" in yarn catalog queries
          - For yarn colors: action = "getYarnColors" if asking about yarn colors
          - For yarn colors pagination: action = "getYarnColors", extract page parameter (e.g., "yarn colors page 2", "page 3 yarn colors")
          - For yarn inventory: action = "getYarnInventory" if asking about yarn inventory/stock/quantity (includes recent PO status)
          - For live inventory: action = "getLiveInventory" if asking about live inventory only (without PO status)
          - For recent PO status: action = "getRecentPOStatus" if asking about recent purchase order status
          - For yarn transactions: action = "getYarnTransactions" if asking about yarn transactions/history
          - For yarn transactions pagination: action = "getYarnTransactions", extract page parameter (e.g., "yarn transactions page 2", "page 3 yarn transactions")
          - For yarn transactions filtered by type: action = "getYarnTransactions", extract transactionType parameter (yarn_issued, yarn_blocked, yarn_stocked, internal_transfer, yarn_returned)
          - For yarn transactions filtered by yarn name: action = "getYarnTransactions", extract yarnName parameter
          - For yarn transactions filtered by order number: action = "getYarnTransactions", extract orderno parameter
          - For yarn transactions filtered by date range: action = "getYarnTransactions", extract dateFrom and dateTo parameters
          - For yarn requisitions: action = "getYarnRequisitions" if asking about yarn requisitions/requests
          - For placing a new yarn purchase order: action = "createYarnPurchaseOrder" if user says "place order", "place new order", "place another yarn purchase order", "place yarn order", "create purchase order" (do NOT use getYarnPurchaseOrders for these)
          - For showing/list of yarn purchase orders: action = "getYarnPurchaseOrders" if user says "show yarn purchase orders", "show yarn place order", "list orders", "yarn purchase orders", "get yarn purchase orders"
          - For single purchase order details: action = "getYarnPurchaseOrderById" if asking for one order by PO number or ID (e.g. "order details PO-2024-001", "show purchase order PO-xxx")
          - For editing order details (items, quantities, supplier): action = "editYarnPurchaseOrder" if user says "edit order", "I wanna edit order PO-xxx", "edit order details" (this is NOT status change)
          - For updating order STATUS only: action = "updateYarnPurchaseOrderStatus" only when user explicitly says "update status", "mark PO-xxx as in transit", "set order to goods received", "change status to ..."
          - For deleting order: action = "deleteYarnPurchaseOrder" if user says "delete order PO-xxx", "cancel order", "remove purchase order"
          - For yarn issue: action = "getYarnIssue" if asking about yarn issued or yarn issue
          - For yarn return: action = "getYarnReturn" if asking about yarn returned or yarn return
          - For yarn types: action = "getYarnTypes" if asking about yarn types, yarn type details, or yarn subtypes
          - For yarn suppliers/brands: action = "getYarnSuppliers" if asking about yarn suppliers, yarn brands, or yarn manufacturers
          - For yarn count sizes: action = "getYarnCountSizes" if asking about yarn count sizes, yarn counts, or yarn sizing
          - For yarn colors: action = "getYarnColors" if asking about yarn colors, yarn colour, yarn color options, what colors yarn has, what colours are available in yarn, or any variation asking about color/colour in yarn context
          - For yarn blends: action = "getYarnBlends" if asking about yarn blends, what blends of yarn, yarn blend types, what blends do you have in yarn, or just "blends" when in yarn context
          - For yarn boxes: action = "getYarnBoxes" if asking about yarn boxes
          - For yarn cones: action = "getYarnCones" if asking about yarn cones
          - For categories: action = "getCategories" if asking about product categories
          - For storage slots: action = "getStorageSlots" if asking about storage slots or storage
          - For raw materials: action = "getRawMaterials" if asking about raw materials
          - For raw materials filtered by group: action = "getRawMaterials", extract groupName parameter
          - For raw materials filtered by type: action = "getRawMaterials", extract type parameter
          - For raw materials filtered by brand: action = "getRawMaterials", extract brand parameter
          - For raw materials filtered by color: action = "getRawMaterials", extract color parameter
          - For available colors in raw materials: action = "getRawMaterialColors" if asking "what colors are available", "any other colour available", "show me available colors", "what other colors", etc.
          - CRITICAL: "raw material in white" or "raw materials in [color]" → getRawMaterials with color="[color]" (NOT groupName)
          - CRITICAL: "any other colour available" or "what colors are available" → getRawMaterialColors (NOT getRawMaterials)
          - CRITICAL: Common color words: white, black, red, blue, green, yellow, orange, purple, pink, brown, grey, gray, beige, navy, cream, golden, gold, silver, transparent, maroon, olive, khaki, tan, ivory, pearl, coral, teal, turquoise, lime, magenta, cyan, violet, indigo, amber, bronze, copper
          - For raw materials filtered by material: action = "getRawMaterials", extract material parameter
          - For raw materials pagination: action = "getRawMaterials", extract page parameter (e.g., "page 2", "page 3")
          - For processes: action = "getProcesses" if asking about processes
          - For product attributes: action = "getProductAttributes" if asking about product attributes or just "attributes"
          - For machine statistics: action = "getMachineStatistics" if asking about machine stats/counts
          - For machines by status: action = "getMachinesByStatus", extract machineStatus (Active, Under Maintenance, Idle)
          - For machines by floor: action = "getMachinesByFloor", extract floor name
          - For production orders: action = "getProductionOrders", extract orderId or status if mentioned
          - For production dashboard: action = "getProductionDashboard" for production overview
          - For orders: action = "getOrders", extract orderId or status if mentioned
          - For sales forecasts: action = "getProductForecast", extract productName and city
          - For product analysis: action = "getProductAnalysis", extract productName (ONLY for retail products, NOT for yarn/machine/raw material/process/attribute/blend)
          - For store analysis: action = "getStoreAnalysisByName", extract storeName (only if a specific store name is mentioned)
          - For city-based analytics: action = "getAnalyticsDashboard", extract city (when asking for analytics/performance in a city)
          - For top products: action = "getTopProducts", extract city if mentioned
          - For capabilities: action = "getCapabilities" if asking about what the system can do
          **SALES DATA (full access for chatbot):**
          - getSalesData = transaction-level sales records (filterable list with Date, Store, Product, Category, Quantity, MRP, Discount, GSV, NSV, Tax). Use for: "show sales", "sales data", "sales records", "sales in [city]", "sales for [product]", "sales at [store]", "sales from [date] to [date]", "last month sales", "sales by category".
          - getSalesReport = aggregated report (KPIs, trends, summaries). Use for: "sales report", "sales summary", "sales trend", "monthly sales".
          - For getSalesData ALWAYS extract any mentioned: city, productName, storeName, dateFrom, dateTo, category, limit (default 50), page, mrpMin (when user says "mrp above X", "MRP > X", "price above X"), mrpMax (when user says "mrp below X", "MRP < X").
          - For sales filtered by city: action = "getSalesData", params: { city: "extracted city" }
          - For sales filtered by product: action = "getSalesData", params: { productName: "extracted product name" }
          - For sales filtered by store: action = "getSalesData", params: { storeName: "extracted store name" }
          - For sales filtered by date range: action = "getSalesData", params: { dateFrom: "YYYY-MM-DD or date string", dateTo: "YYYY-MM-DD or date string" }
          - For "last week/month" sales: action = "getSalesData", params: { period: "last week" or "last month" } (backend will resolve dates)
          - Combine multiple filters when user says e.g. "sales in Mumbai for product X last month" → getSalesData with city, productName, period
          - For analytics: action = "getAnalyticsDashboard" for general business insights or city-based analysis
          - For brand performance: action = "getBrandPerformance" if asking about brand performance, brand data, or brand analysis
          - For product count: action = "getProductCount" if asking about product inventory
          - For products list or items: action = "getProductsList" if asking about list of products/items from master catalog
          - For stores list: action = "getStoresList" if asking about list of stores
          - For stores filtered by city: action = "getStoresList", extract city parameter
          - For stores filtered by status: action = "getStoresList", extract status parameter (active/inactive)
          - For stores filtered by city and status: action = "getStoresList", extract both city and status parameters
          
          CRITICAL RULE: NEVER use "getProductAnalysis" for queries containing these keywords: yarn, machine, raw material, process, attribute, blend, supplier, color, count size, type, types, category, categories, box, boxes, cone, cones, storage. 
          - "yarn types" or any query asking about yarn types MUST use action "getYarnTypes"
          - "yarn suppliers" or any query asking about yarn suppliers/brands MUST use action "getYarnSuppliers"  
          - "yarn colors" or any query asking about colors/colours in yarn context (e.g., "what colors do you have in yarn", "tell me about colours in yarn", "what colours are available in yarn") MUST use action "getYarnColors"
          - "yarn blends" or any query asking about blends in yarn context (e.g., "what blends of yarn do you have", "tell me about yarn blends", "what yarn blends are available") MUST use action "getYarnBlends"
          - "yarn boxes" MUST use action "getYarnBoxes"
          - "yarn cones" MUST use action "getYarnCones"
          - "categories" MUST use action "getCategories"
          - "storage slots" or "storage" MUST use action "getStorageSlots"
          - "raw materials" MUST use action "getRawMaterials"
          - "processes" MUST use action "getProcesses"
          - "product attributes" or "attributes" MUST use action "getProductAttributes"
          Use the specific actions listed above instead.
          
          NATURAL LANGUAGE UNDERSTANDING FOR YARN CATEGORIES:
          - When user asks "can you tell me about colours do you have in yarn" → Understand this is asking about yarn colors → getYarnColors
          - When user asks "what blends of yarn do you have" → Understand this is asking about yarn blends → getYarnBlends
          - When user asks "what colors do you have in yarn" → Understand this is asking about yarn colors → getYarnColors
          - When user asks "tell me about yarn colors" → getYarnColors
          - When user asks "what yarn blends are available" → getYarnBlends
          - When user asks "what types of yarn" → getYarnTypes
          - When user asks "what suppliers do you have for yarn" → getYarnSuppliers
          - When user asks "what count sizes are available in yarn" → getYarnCountSizes
          - Always look for the category keyword (colors, blends, types, suppliers, count sizes) AND the context (yarn) to determine the correct action
          - If the query mentions yarn AND a category (color/colour/blend/type/supplier/count size), use the corresponding yarn category action
          
          **COMPREHENSIVE NATURAL LANGUAGE EXAMPLES FOR ALL CATEGORIES:**
          
          **YARN CATEGORIES - Natural Language Variations:**
          - "what kinds of yarn do you have" → getYarnTypes
          - "tell me about yarn varieties" → getYarnTypes
          - "what types of yarn are available" → getYarnTypes
          - "show me yarn type options" → getYarnTypes
          - "what colors can I choose from for yarn" → getYarnColors
          - "show me yarn color options" → getYarnColors
          - "what colors do we have in yarn" → getYarnColors
          - "tell me about yarn color choices" → getYarnColors
          - "what yarn suppliers work with us" → getYarnSuppliers
          - "who supplies yarn" → getYarnSuppliers
          - "show me yarn brands" → getYarnSuppliers
          - "what suppliers do we have for yarn" → getYarnSuppliers
          - "what blends are available in yarn" → getYarnBlends
          - "tell me about yarn blend options" → getYarnBlends
          - "what yarn blends do you have" → getYarnBlends
          - "show me available yarn blends" → getYarnBlends
          - "what count sizes do you have for yarn" → getYarnCountSizes
          - "show me yarn sizing options" → getYarnCountSizes
          - "what yarn counts are available" → getYarnCountSizes
          - "tell me about yarn count sizes" → getYarnCountSizes
          
          **YARN MANAGEMENT - Natural Language Variations:**
          - "how much yarn stock do we have" → getYarnInventory
          - "what yarn do we have in stock" → getYarnInventory
          - "show me our yarn inventory" → getYarnInventory
          - "tell me about yarn inventory" → getYarnInventory
          - "what's our yarn stock level" → getYarnInventory
          - "what yarn transactions happened" → getYarnTransactions
          - "show me yarn history" → getYarnTransactions
          - "tell me about yarn transactions" → getYarnTransactions
          - "what yarn activity do we have" → getYarnTransactions
          - "place order", "place another yarn purchase order", "place yarn order" → createYarnPurchaseOrder (place new order)
          - "show yarn purchase orders", "show yarn place order", "show me yarn purchase orders" → getYarnPurchaseOrders (list)
          - "do we have any yarn orders pending" → getYarnPurchaseOrders
          - "what's the status of yarn we ordered" → getYarnPurchaseOrders
          - "tell me about yarn orders" → getYarnPurchaseOrders
          - "show me the yarn catalog" → getYarnCatalog
          - "what types of yarn are in the catalog" → getYarnCatalog
          - "list yarn catalog" → getYarnCatalog
          - "show me yarn list" → getYarnCatalog
          
          **STORES - Natural Language Variations:**
          - "where are our stores" → getStoresList
          - "show me store locations" → getStoresList
          - "what stores do we have" → getStoresList
          - "tell me about our stores" → getStoresList
          - "list all stores" → getStoresList
          - "show me store list" → getStoresList
          - "which stores are in Mumbai" → getStoresList with city="mumbai"
          - "show me stores in Delhi" → getStoresList with city="delhi"
          - "what stores are in Bangalore" → getStoresList with city="bangalore"
          - "where are our stores in Mumbai" → getStoresList with city="mumbai"
          - "what stores are currently open" → getStoresList with status="active"
          - "which stores are active" → getStoresList with status="active"
          - "show me active stores" → getStoresList with status="active"
          - "what stores are closed" → getStoresList with status="inactive"
          - "show me inactive stores" → getStoresList with status="inactive"
          
          **TOP PRODUCTS - Natural Language Variations:**
          - "what products sell the most" → getTopProducts
          - "show me best selling products" → getTopProducts
          - "what are our top sellers" → getTopProducts
          - "tell me about top products" → getTopProducts
          - "which products are selling best" → getTopProducts
          - "show me popular products" → getTopProducts
          - "best products in Mumbai" → getTopProducts with city="mumbai"
          - "top 10 products in Delhi" → getTopProducts with city="delhi", limit=10
          - "what sells best in Mumbai" → getTopProducts with city="mumbai"
          - "top selling products in Delhi" → getTopProducts with city="delhi"
          
          **MASTER CONSOLE CATEGORIES - Natural Language Variations:**
          
          **Processes:**
          - "what processes do we have" → getProcesses
          - "show me all processes" → getProcesses
          - "list the processes" → getProcesses
          - "tell me about processes" → getProcesses
          - "what processes are available" → getProcesses
          
          **Machines:**
          - "how many machines are there" → getMachineStatistics
          - "tell me about our machines" → getMachineStatistics
          - "what machines do we have" → getMachineStatistics
          - "show me machine information" → getMachineStatistics
          - "give me machine stats" → getMachineStatistics
          - "which machines are working" → getMachinesByStatus with machineStatus="Active"
          - "what machines are active" → getMachinesByStatus with machineStatus="Active"
          - "show me active machines" → getMachinesByStatus with machineStatus="Active"
          - "which machines are idle" → getMachinesByStatus with machineStatus="Idle"
          - "show me idle machines" → getMachinesByStatus with machineStatus="Idle"
          - "what machines are on floor 1" → getMachinesByFloor with floor="Floor 1"
          - "show me machines on knitting floor" → getMachinesByFloor with floor="Knitting"
          - "which machines are on floor 2" → getMachinesByFloor with floor="Floor 2"
          
          **Items/Products (Master Catalog):**
          - "show me items" → getProductsList
          - "what items do we have" → getProductsList
          - "list all items" → getProductsList
          - "show me the product catalog" → getProductsList
          - "tell me about items" → getProductsList
          - "what products are in the catalog" → getProductsList
          - "show me master catalog" → getProductsList
          
          **Raw Materials:**
          - "what raw materials are available" → getRawMaterials
          - "show me raw materials" → getRawMaterials
          - "tell me about raw materials" → getRawMaterials
          - "list raw materials" → getRawMaterials
          - "what raw materials do we have" → getRawMaterials
          - "what raw materials do we have in white" → getRawMaterials with color="white"
          - "show me white raw materials" → getRawMaterials with color="white"
          - "raw materials in black" → getRawMaterials with color="black"
          - "show me raw materials by Packing Material" → getRawMaterials with groupName="Packing Material"
          - "what raw materials are in Packing Material group" → getRawMaterials with groupName="Packing Material"
          
          **Attributes:**
          - "what attributes can products have" → getProductAttributes
          - "show me product attributes" → getProductAttributes
          - "list attributes" → getProductAttributes
          - "tell me about attributes" → getProductAttributes
          - "what attributes are available" → getProductAttributes
          
          **Categories:**
          - "what product categories exist" → getCategories
          - "show me categories" → getCategories
          - "list categories" → getCategories
          - "tell me about categories" → getCategories
          - "what categories do we have" → getCategories
          
          **Storage Slots:**
          - "what storage slots are available" → getStorageSlots
          - "show me storage" → getStorageSlots
          - "where can we store items" → getStorageSlots
          - "list storage slots" → getStorageSlots
          - "tell me about storage" → getStorageSlots
          - "what storage do we have" → getStorageSlots
          
          IMPORTANT: 
          - "mumbai", "delhi", "bangalore" etc. are CITIES, not store names
          - Store names are specific business names like "ABC Store", "Central Mall", "Reliance Mart"
          - When someone asks for "analytics for mumbai" or "store performance in mumbai", use getAnalyticsDashboard with city="mumbai"
          - When someone asks for "analytics for mumbai store" (meaning stores in Mumbai city), use getAnalyticsDashboard with city="mumbai"
          - Only use getStoreAnalysisByName when a specific store name is mentioned like "ABC store" or "Store XYZ"
          - The word "store" after a city name usually means "stores in that city", not a store name
          
          Examples:
          - "next months sales forecast for PE Mens Full Rib Navy FL in mumbai" → getProductForecast with productName="PE Mens Full Rib Navy FL", city="mumbai"
          - "give me PE Mens Full Rib White FL analysis" → getProductAnalysis with productName="PE Mens Full Rib White FL"
          - "show me store ABC data" → getStoreAnalysisByName with storeName="ABC"
          - "analytics for mumbai store" → getAnalyticsDashboard with city="mumbai" (stores in Mumbai)
          - "store performance in mumbai" → getAnalyticsDashboard with city="mumbai" (stores in Mumbai)
          - "give me analytics for mumbai store" → getAnalyticsDashboard with city="mumbai" (stores in Mumbai)
          - "what are your capabilities" → getCapabilities
          - "top 5 products in delhi" → getTopProducts with city="delhi", limit=5
          - "show me machine statistics" → getMachineStatistics
          - "machines on floor 1" → getMachinesByFloor with floor="Floor 1"
          - "active machines" or "what machines are active" → getMachinesByStatus with machineStatus="Active"
          - "which machines are idle" → getMachinesByStatus with machineStatus="Idle"
          - "show me machines that are under maintenance" → getMachinesByStatus with machineStatus="Under Maintenance"
          - "show me yarn catalog" → getYarnCatalog
          - "yarn inventory" → getYarnInventory (includes recent PO status)
          - "live inventory" → getLiveInventory (inventory only, no PO status)
          - "recent po status" → getRecentPOStatus
          - "yarn transactions" → getYarnTransactions
          - "yarn transactions page 2" or "page 2 yarn transactions" → getYarnTransactions with page=2
          - "yarn transactions type issued" or "yarn issued transactions" → getYarnTransactions with transactionType="yarn_issued"
          - "yarn transactions for order ORD-001" → getYarnTransactions with orderno="ORD-001"
          - "yarn transactions from 2024-01-01 to 2024-12-31" → getYarnTransactions with dateFrom and dateTo
          - "yarn issue" or "yarn issued" → getYarnIssue
          - "yarn return" or "yarn returned" → getYarnReturn
          - "articles for order ORD-000001" or "articles by order ORD-000001" → getArticlesByOrder with orderNumber="ORD-000001"
          - "article FC231" or "article ART001" → getArticleById with articleId="FC231" or "ART001"
          - "yarn types" → getYarnTypes
          - "yarn suppliers" or "yarn brands" → getYarnSuppliers
          - "yarn colors" or "yarn colours" → getYarnColors
          - "yarn blends" or "blends" → getYarnBlends
          - "can you tell me about colours do you have in yarn" → getYarnColors
          - "what colors do you have in yarn" → getYarnColors
          - "what colours are available in yarn" → getYarnColors
          - "tell me about yarn colors" → getYarnColors
          - "show me yarn color options" → getYarnColors
          - "what blends of yarn do you have" → getYarnBlends
          - "what yarn blends are available" → getYarnBlends
          - "tell me about yarn blends" → getYarnBlends
          - "show me yarn blend types" → getYarnBlends
          - "what types of yarn do you have" → getYarnTypes
          - "tell me about yarn types" → getYarnTypes
          - "what yarn suppliers do you have" → getYarnSuppliers
          - "tell me about yarn suppliers" → getYarnSuppliers
          - "what yarn brands are available" → getYarnSuppliers
          - "what count sizes of yarn do you have" → getYarnCountSizes
          - "tell me about yarn count sizes" → getYarnCountSizes
          - "yarn boxes" → getYarnBoxes
          - "yarn cones" → getYarnCones
          - "categories" or "show me categories" → getCategories
          - "storage slots" or "storage" → getStorageSlots
          - "raw materials" or "show me raw materials" → getRawMaterials
          - "raw materials by [group name]" or "raw materials by group [group name]" → getRawMaterials with groupName="[group name]"
          - "raw material in white" or "raw materials in [color]" → getRawMaterials with color="[color]" (NOT groupName - check if it's a color word first)
          - "raw materials type [type]" or "raw materials of type [type]" → getRawMaterials with type="[type]"
          - "raw materials brand [brand]" or "raw materials by brand [brand]" → getRawMaterials with brand="[brand]"
          - "raw materials color [color]" or "[color] raw materials" → getRawMaterials with color="[color]"
          - "raw materials page 2" or "page 2 raw materials" → getRawMaterials with page=2
          - CRITICAL: When user says "raw material in white" or "raw materials in [color word]", extract color parameter, NOT groupName. Color words: white, black, red, blue, green, yellow, orange, purple, pink, brown, grey, gray, beige, navy, cream, golden, gold, silver, transparent, maroon, olive, khaki, tan, ivory, pearl, coral, teal, turquoise, lime, magenta, cyan, violet, indigo, amber, bronze, copper
          - "yarn catalog page 2" or "page 2 yarn catalog" or "show yarn catalog page 2" → getYarnCatalog with page=2
          - CRITICAL: When extracting page parameter, use the exact number from the query (e.g., "page 2" → page=2, "page 3" → page=3)
          - "yarn colors page 2" or "page 2 yarn colors" → getYarnColors with page=2
          - "products page 2" or "items page 2" or "products list page 2" → getProductsList with page=2
          - "stores page 2" or "stores list page 2" → getStoresList with page=2
          - "processes" or "show me processes" → getProcesses
          - "product attributes" or "attributes" → getProductAttributes
          - "items" or "products list" or "list products" → getProductsList
          - "stores" or "stores list" or "list stores" → getStoresList
          - "stores in [city]" or "stores in mumbai" → getStoresList with city="mumbai"
          - "active stores" or "stores active" → getStoresList with status="active"
          - "inactive stores" or "stores inactive" → getStoresList with status="inactive"
          - "stores in [city] active" or "active stores in [city]" → getStoresList with city="[city]" and status="active"
          - "stores in mumbai active" → getStoresList with city="mumbai", status="active"
          - "show me sales", "sales data", "all sales", "sales records", "list sales" → getSalesData (no filters, or with limit)
          - "sales in Mumbai", "sales for Delhi", "sales in [city]", "sales data of [city] store", "[city] store sales" → getSalesData with city ONLY (do NOT set storeName to "[city] store")
          - "sales for [product name]", "sales of [product]", "how much did we sell of [product]" → getSalesData with productName
          - "sales at [store]", "sales for store [name]", "store [name] sales" → getSalesData with storeName (only when [name] is a specific store name, not "[city] store")
          - "sales from Jan 1 to Jan 31", "sales between [date] and [date]" → getSalesData with dateFrom and dateTo (use ISO or YYYY-MM-DD when possible)
          - "last month sales", "sales last week", "this week sales" → getSalesData with period: "last month" or "last week" or "today"
          - "sales in Mumbai for product X", "Mumbai sales last month" → getSalesData with city, productName and/or period (combine filters)
          - "sales with MRP above 299", "products mrp above 299", "sales of products which has mrp above 299" → getSalesData with mrpMin: 299 (and city/product/date if mentioned)
          - "sales report", "sales summary", "sales trend" → getSalesReport
          - "production orders" → getProductionOrders
          - "production dashboard" → getProductionDashboard
          
          CRITICAL: Do NOT use getProductAnalysis for yarn, machine, raw material, process, attribute, or blend queries. Use the specific actions above instead.
          
          **CONTEXT-AWARE FOLLOW-UP QUERIES:**
          - If user asks "which are white", "show me the red ones", "what about black", "any inactive", etc., check if they were previously viewing raw materials, products, stores, or machines
          - If previous context was raw materials → use getRawMaterials with color filter
          - If previous context was products → use getProductsList or getProductAnalysis (depending on query)
          - If previous context was stores → use getStoresList with appropriate filters
          - If previous context was machines (getMachinesByStatus, getMachineStatistics, getMachinesByFloor) → use getMachinesByStatus with status filter
          - When in doubt, prefer the most recent context from conversation history
          - Examples:
            - Previous: "show me raw materials" → User: "which are white" → getRawMaterials with color="white"
            - Previous: "raw materials" → User: "show me the black ones" → getRawMaterials with color="black"
            - Previous: "raw materials" → User: "what about Packing Material" → getRawMaterials with groupName="Packing Material"
            - Previous: "machines which are active" → User: "any inactive" → getMachinesByStatus with machineStatus="Idle"
            - Previous: "active machines" → User: "show me idle" → getMachinesByStatus with machineStatus="Idle"
            - Previous: "machines which are active" → User: "no inactive machines" → getMachinesByStatus with machineStatus="Idle" (will show "No inactive machines found" if none exist)`
      },
      ...historyMessages,
      {
        role: 'user',
        content: `Analyze this query: "${question}"`
      }
    ];
    const aiResponse = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages,
      temperature: 0.1,
      max_tokens: 300
    });

    const content = aiResponse.choices[0]?.message?.content?.trim();
    if (!content) {
      console.log('No response from OpenAI');
      return null;
    }

    try {
      // Extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const intent = JSON.parse(jsonMatch[0]);
        
        // Validate: action is required; params may be null (e.g. createYarnPurchaseOrder returns numbered list / chat flow)
        if (intent.action) {
          return {
            action: intent.action,
            params: intent.params ?? null,
            description: intent.description || 'AI-detected intent',
            confidence: intent.confidence ?? 0.9
          };
        }
      }
      
      console.log('Invalid JSON response from OpenAI:', content);
      return null;
      
    } catch (parseError) {
      console.error('Error parsing OpenAI response:', parseError);
      console.log('Raw response:', content);
      return null;
    }
    
  } catch (error) {
    console.error('Error using OpenAI for intent detection:', error);
    return null;
  }
};

/**
 * Generate a short natural-language reply so the agent feels conversational, not template-driven.
 * Used as the visible "content" line above data/HTML. Safe to call; returns null on failure.
 * @param {string} userMessage - What the user said
 * @param {Object} options - { action: string, summary: string, poNumber?: string }
 * @returns {Promise<string|null>} 1-2 sentence agent reply or null
 */
/**
 * Use GPT to suggest the best-matching color/term from available yarn terms for a possibly mistyped user keyword.
 * @param {string} userKeyword - What the user typed (e.g. "floden", "golen")
 * @param {string[]} availableTerms - Unique terms (colors, descriptors) extracted from yarn names
 * @returns {Promise<string|null>} Corrected keyword or null if no suggestion / API error
 */
const suggestYarnKeywordCorrection = async (userKeyword, availableTerms) => {
  if (!userKeyword || !Array.isArray(availableTerms) || availableTerms.length === 0) return null;
  const termsList = [...new Set(availableTerms)].slice(0, 150).join(', ');
  try {
    const openaiResponse = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: `You are a typo-correction helper for a yarn catalog. The user typed a keyword that might be a misspelling of a color or descriptor.
Given the user's keyword and a list of available terms from our yarn names, reply with exactly one term from the list that best matches what the user likely meant. Consider common typos (e.g. floden->golden, golen->golden, blak->black).
Reply with ONLY that single term, nothing else. If no term is a plausible match, reply with the user's keyword unchanged.`
        },
        {
          role: 'user',
          content: `User keyword: "${userKeyword}"
Available terms: ${termsList}
Reply with one term that best matches the user's keyword (or the user's keyword if no match).`
        }
      ],
      temperature: 0.1,
      max_tokens: 50
    });
    const text = openaiResponse.choices[0]?.message?.content?.trim();
    if (!text) return null;
    const corrected = text.split(/[\s,]/)[0].trim();
    return corrected || userKeyword;
  } catch (err) {
    console.warn('suggestYarnKeywordCorrection failed:', err?.message);
    return null;
  }
};

/**
 * Extract color/descriptor-like terms from yarn names for typo matching (e.g. "20s-Black-JET BLACK-Bamboo" -> Black, JET, BLACK, Bamboo).
 * @param {string[]} yarnNames
 * @returns {string[]}
 */
const extractTermsFromYarnNames = (yarnNames) => {
  if (!Array.isArray(yarnNames) || yarnNames.length === 0) return [];
  const seen = new Set();
  const terms = [];
  for (const name of yarnNames) {
    const tokens = String(name).split(/[\s\-/]+/).filter(Boolean);
    for (const t of tokens) {
      const w = t.trim();
      if (w.length >= 2 && !/^\d+$/.test(w)) {
        const key = w.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          terms.push(w);
        }
      }
    }
  }
  return terms;
};

export const generateNaturalAgentReply = async (userMessage, options = {}) => {
  const { action, summary, poNumber } = options;
  if (!userMessage || typeof userMessage !== 'string') return null;
  try {
    const actionLabel = action || 'completed an action';
    const summaryText = summary || 'Retrieved the requested information.';
    const poPart = poNumber ? ` (Order ${poNumber})` : '';
    const openaiResponse = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: `You are Addon, a friendly business assistant. The user just said something and we've already handled it in the system.
Your job: reply in 1-2 short sentences as if you're confirming or briefly summarizing. Sound like a person, not a bot.
- Be warm and natural. Don't say "I have retrieved" or "Here is the data." Say it conversationally.
- Don't list bullets or repeat the data—the data will be shown below your message.
- Keep it under 2 sentences. No greetings like "Hello!" unless the user greeted you.`
        },
        {
          role: 'user',
          content: `User said: "${userMessage.slice(0, 300)}"
We did: ${actionLabel}${poPart}. ${summaryText}
Reply in 1-2 short, natural sentences as the agent.`
        }
      ],
      temperature: 0.7,
      max_tokens: 120
    });
    const text = openaiResponse.choices[0]?.message?.content?.trim();
    return text || null;
  } catch (err) {
    console.warn('generateNaturalAgentReply failed:', err?.message);
    return null;
  }
};

/**
 * Enhanced intent detection for AI tool calling
 * @param {string} question - User's question
 * @param {Object} [options] - { conversationHistory?: Array<{role, content}> } for GPT-style context
 * @returns {Object|null} Intent object or null if no match
 */
export const detectIntent = async (question, options = {}) => {
  const { conversationHistory } = options;
  // Normalize: fix common typos
  let normalizedQuestion = question.trim();
  normalizedQuestion = normalizedQuestion.replace(/quatity/gi, 'quantity');
  normalizedQuestion = normalizedQuestion.replace(/invetory/gi, 'inventory');
  normalizedQuestion = normalizedQuestion.replace(/colour/gi, 'color');
  normalizedQuestion = normalizedQuestion.toLowerCase();
  
  // PRE-CHECK: Handle greetings - return null so conversation service handles it
  const greetingPatterns = [/^hey$/i, /^hi$/i, /^hello$/i, /^greetings$/i];
  if (greetingPatterns.some(pattern => pattern.test(normalizedQuestion))) {
    console.log(`[detectIntent] Detected greeting, returning null for conversation service`);
    return null; // Let conversation service handle greetings naturally
  }
  
  // PRE-CHECK: Direct yarn color queries
  const yarnColorPatterns = [
    /yarn\s+color/i,
    /yarn\s+colour/i,
    /tell me.*yarn.*color/i,
    /show me.*yarn.*color/i,
    /what.*yarn.*color/i,
    /about.*yarn.*color/i,
    /can you tell me.*yarn.*color/i
  ];
  
  if (yarnColorPatterns.some(pattern => pattern.test(normalizedQuestion))) {
    console.log(`[detectIntent] Detected yarn color query`);
    return {
      action: 'getYarnColors',
      params: {},
      description: 'Get yarn colors',
      confidence: 0.95
    };
  }
  
  // PRE-CHECK: Yarn inventory/quantity queries
  const yarnInventoryPatterns = [
    /yarn\s+quantity/i,
    /yarn\s+inventory/i,
    /yarn.*quantity.*inventory/i,
    /yarn.*inventory.*quantity/i,
    /how much yarn.*inventory/i
  ];
  
  if (yarnInventoryPatterns.some(pattern => pattern.test(normalizedQuestion))) {
    console.log(`[detectIntent] Detected yarn inventory query`);
    return {
      action: 'getYarnInventory',
      params: {},
      description: 'Get yarn inventory',
      confidence: 0.95
    };
  }

  // PRE-CHECK: "buy [yarn] from [supplier]" and optional "100 units of ... at 50" for one-shot order
  const buyFromMatch = question.trim().match(/(?:i\s+(?:wanna|want to)\s+)?(?:buy|purchase|order|get)\s+(.+?)\s+from\s+(.+)/i);
  if (buyFromMatch) {
    let yarnPart = (buyFromMatch[1] || '').trim();
    const supplierPartRaw = (buyFromMatch[2] || '').trim();
    let supplierPart = supplierPartRaw;
    let rate;
    let gstRate;
    let quantity;
    // Strip ", gst 12%" or " and gst is 12%" from supplier name first
    const commaGst = supplierPart.match(/\s*,\s*(?:and\s+)?gst\s+(?:is\s+)?(\d+(?:\.\d+)?)\s*%?/i);
    if (commaGst) {
      gstRate = parseFloat(commaGst[1]);
      supplierPart = supplierPart.replace(/\s*,\s*(?:and\s+)?gst\s+(?:is\s+)?\d+(?:\.\d+)?\s*%?/gi, '').trim();
    }
    const gst = supplierPart.match(/\s+(?:and\s+)?gst\s+(?:is\s+)?(\d+(?:\.\d+)?)\s*%?/i);
    if (gst) {
      gstRate = parseFloat(gst[1]);
      supplierPart = supplierPart.replace(/\s+(?:and\s+)?gst\s+(?:is\s+)?\d+(?:\.\d+)?\s*%?/gi, '').trim();
    }
    // Strip ", 50 pieces at 500 each" or " and each piece at 500" or " at 500 per piece" and capture rate
    const commaPiecesAt = supplierPart.match(/\s*,\s*(\d+)\s*pieces?\s*(?:(?:and\s+)?(?:each\s+piece\s+at|at)\s+(?:₹|rs\.?|rupees?\s+)?(\d+(?:\.\d+)?)\s*(?:each|per\s*piece)?)?/i);
    if (commaPiecesAt) {
      quantity = parseInt(commaPiecesAt[1], 10);
      if (commaPiecesAt[2] != null) rate = parseFloat(commaPiecesAt[2]);
      supplierPart = supplierPart.slice(0, commaPiecesAt.index).trim();
    }
    const eachPieceAt = supplierPart.match(/\s+(?:and\s+)?(?:each\s+piece\s+at|at)\s+(?:₹|rs\.?|rupees?\s+)?(\d+(?:\.\d+)?)(?:\s*per\s*piece)?(?:\s*each)?/i);
    if (eachPieceAt) {
      rate = parseFloat(eachPieceAt[1]);
      supplierPart = supplierPart.slice(0, eachPieceAt.index).trim();
    } else if (!commaPiecesAt) {
      const rateMatch = supplierPartRaw.match(/\s+at\s+(?:₹|rs\.?|rupees?\s+)?(\d+(?:\.\d+)?)\s*$/i);
      if (rateMatch) {
        rate = parseFloat(rateMatch[1]);
        supplierPart = supplierPartRaw.slice(0, rateMatch.index).trim();
        if (gst) supplierPart = supplierPart.replace(/\s+(?:and\s+)?gst\s+is\s+\d+(?:\.\d+)?\s*%?/i, '').trim();
      }
    }
    // Strip " i want 50 pieces" so supplier name is just "wumpum private limited"
    const iWantPieces = supplierPart.match(/\s+i\s+want\s+(\d+)\s*pieces?/i);
    if (iWantPieces) {
      quantity = parseInt(iWantPieces[1], 10);
      supplierPart = supplierPart.slice(0, iWantPieces.index).trim();
    }
    // Strip ", 50 pieces" when user said "wumpum private limited, 50 pieces at 500 each"
    const commaPieces = supplierPart.match(/\s*,\s*(\d+)\s*pieces?/i);
    if (commaPieces) {
      quantity = parseInt(commaPieces[1], 10);
      supplierPart = supplierPart.slice(0, commaPieces.index).trim();
    }
    const qtyMatch = yarnPart.match(/^(\d+)\s*(?:pieces?\s+of\s+)\s*(.+)$/i) || yarnPart.match(/^(\d+)\s*(?:units?\s+of\s+)\s*(.+)$/i);
    if (qtyMatch) {
      quantity = parseInt(qtyMatch[1], 10);
      yarnPart = qtyMatch[2].trim();
    }
    if (supplierPart && yarnPart && !/^(yarn|some)$/i.test(yarnPart)) {
      const poItem = { yarnName: yarnPart };
      // Leading "33/2/120" before product name is size and count — extract and set on PO item
      const sizeCountMatch = yarnPart.match(/^(\d+(?:\/\d+)+)\s*[-–]\s*/);
      if (sizeCountMatch) poItem.sizeCount = sizeCountMatch[1];
      if (quantity != null && quantity > 0) poItem.quantity = quantity;
      if (rate != null && rate > 0) poItem.rate = rate;
      if (gstRate != null && gstRate >= 0) poItem.gstRate = gstRate;
      console.log(`[detectIntent] Detected "buy [yarn] from [supplier]" — supplier + yarn${quantity != null ? `, qty ${quantity}` : ''}${rate != null ? `, rate ${rate}` : ''}${gstRate != null ? `, gst ${gstRate}%` : ''}${poItem.sizeCount ? `, sizeCount ${poItem.sizeCount}` : ''}`);
      return {
        action: 'createYarnPurchaseOrder',
        params: { supplierQuery: supplierPart, poItems: [poItem] },
        description: 'Place order for specific yarn from named supplier',
        confidence: 0.95
      };
    }
  }
  
  // CRITICAL: Check regex patterns FIRST for yarn/machine/raw material/process/attribute queries
  // This prevents AI from misclassifying these specific queries
  const criticalKeywords = ['yarn', 'machine', 'raw material', 'process', 'attribute', 'blend', 'supplier', 'color', 'count size', 'types', 'category', 'categories', 'box', 'boxes', 'cone', 'cones', 'storage', 'order'];
  const hasCriticalKeyword = criticalKeywords.some(keyword => normalizedQuestion.includes(keyword));
  console.log(`[detectIntent] Question: "${normalizedQuestion}", Has critical keyword: ${hasCriticalKeyword}`);
  
  if (hasCriticalKeyword) {
    // Check regex patterns first for critical keywords
    const intents = [
      // YARN PURCHASE ORDER: User selected a supplier from disambiguation or "see yarn list" for one supplier
      {
        pattern: /^SUPPLIER_SELECTED:(.+)$/i,
        action: 'createYarnPurchaseOrder',
        extractParams: (match) => ({ preSelectedSupplierId: match[1].trim(), showSupplierList: true }),
        description: 'Start place-order flow with pre-selected supplier (numbered list)'
      },
      // YARN PURCHASE ORDER: "Show supplier list" when user chose to see list (must be before generic place order)
      {
        pattern: /show\s+(?:me\s+)?(?:the\s+)?supplier\s+list|supplier\s+list|see\s+(?:the\s+)?supplier\s+list|option\s*2|choose\s+from\s+(?:the\s+)?list|show\s+list/i,
        action: 'createYarnPurchaseOrder',
        extractParams: () => ({ showSupplierList: true }),
        description: 'Show supplier list for place order (numbered list)'
      },
      // YARN PURCHASE ORDER: "buy [yarn] from [supplier]" — capture both so we ask only quantity/rate, no supplier list
      {
        pattern: /(?:i\s+(?:wanna|want to)\s+)?(?:buy|purchase|order|get)\s+(.+?)\s+from\s+(.+)/i,
        action: 'createYarnPurchaseOrder',
        extractParams: (match) => {
          const yarnPart = (match[1] || '').trim();
          let supplierPart = (match[2] || '').trim();
          if (!supplierPart) return {};
          // Strip ", gst 12%", " and gst is 12%", ", 50 pieces at 500 each", " at 500 per piece", " i want 50 pieces", ", 50 pieces" so supplier name is clean
          supplierPart = supplierPart.replace(/\s*,\s*(?:and\s+)?gst\s+(?:is\s+)?\d+(?:\.\d+)?\s*%?/gi, '').trim();
          supplierPart = supplierPart.replace(/\s+(?:and\s+)?gst\s+(?:is\s+)?\d+(?:\.\d+)?\s*%?/gi, '').trim();
          const eachPieceAtComma = supplierPart.match(/\s*,\s*\d+\s*pieces?\s*(?:(?:and\s+)?(?:each\s+piece\s+at|at)\s+(?:₹|rs\.?|rupees?\s+)?\d+(?:\.\d+)?\s*(?:each|per\s*piece)?)?/i);
          if (eachPieceAtComma) supplierPart = supplierPart.slice(0, eachPieceAtComma.index).trim();
          const eachPieceAt = supplierPart.match(/\s+(?:and\s+)?(?:each\s+piece\s+at|at)\s+(?:₹|rs\.?|rupees?\s+)?(\d+(?:\.\d+)?)(?:\s*per\s*piece)?(?:\s*each)?/i);
          if (eachPieceAt) supplierPart = supplierPart.slice(0, eachPieceAt.index).trim();
          const iWantPieces = supplierPart.match(/\s+i\s+want\s+\d+\s*pieces?/i);
          if (iWantPieces) supplierPart = supplierPart.slice(0, iWantPieces.index).trim();
          supplierPart = supplierPart.replace(/\s*,\s*\d+\s*pieces?/gi, '').trim();
          if (!yarnPart || /^(yarn|some)$/i.test(yarnPart)) return { supplierQuery: supplierPart };
          const poItem = { yarnName: yarnPart };
          const sizeCountMatch = yarnPart.match(/^(\d+(?:\/\d+)+)\s*[-–]\s*/);
          if (sizeCountMatch) poItem.sizeCount = sizeCountMatch[1];
          return { supplierQuery: supplierPart, poItems: [poItem] };
        },
        description: 'Place order for specific yarn from named supplier'
      },
      // YARN PURCHASE ORDER: User mentioned supplier name only - "purchase yarn from Allen Solley", "buy from Wampum"
      {
        pattern: /(?:purchase|buy|order|get|want to purchase|want to buy|lets? purchase)\s+(?:yarn\s+)?(?:from|with)\s+([^,.?!]+)/i,
        action: 'createYarnPurchaseOrder',
        extractParams: (match) => {
          const name = (match[1] || '').trim();
          if (!name) return {};
          return { supplierQuery: name };
        },
        description: 'Place order with named supplier'
      },
      // YARN PURCHASE ORDER: Place/Create must be checked BEFORE list (so "place another yarn purchase order" → create, not list)
      {
        pattern: /place\s+(?:another\s+)?(?:new\s+)?(?:yarn\s+)?(?:purchase\s+)?order|create\s+(?:new\s+)?(?:yarn\s+)?(?:purchase\s+)?order|place\s+order|create\s+purchase\s+order|place\s+yarn\s+order|(?:purchase|buy)\s+yarn|want to purchase yarn|lets? purchase yarn/i,
        action: 'createYarnPurchaseOrder',
        extractParams: () => ({}),
        description: 'Place new yarn purchase order'
      },
      // Show/list yarn purchase orders (list when user asks to see/show/list; "place order" is handled above)
      {
        pattern: /(?:show|list|get|see|tell\s+me\s+about|what\s+are|display)\s+(?:me\s+)?(?:the\s+)?(?:yarn\s+)?(?:purchase\s+)?orders?|(?:show\s+)?yarn\s+place\s+order(?:s)?|yarn\s+purchase\s+orders?|yarn\s+po\b|purchase\s+orders?\s+(?:for\s+)?yarn|yarn\s+purchased|status\s+of\s+yarn\s+purchased|yarn\s+purchase\s+status|do\s+you\s+order\s+yarn|(?:what|show|tell)\s+me\s+(?:about\s+)?yarn\s+(?:purchase|order|po)/i,
        action: 'getYarnPurchaseOrders',
        extractParams: () => ({}),
        description: 'Get yarn purchase orders (list)'
      },
      {
        pattern: /delete\s+(?:yarn\s+)?(?:purchase\s+)?order\s+(?:po-?)?[\w\-]+|cancel\s+(?:yarn\s+)?(?:purchase\s+)?order\s+(?:po-?)?[\w\-]+|remove\s+(?:purchase\s+)?order\s+(?:po-?)?[\w\-]+/i,
        action: 'deleteYarnPurchaseOrder',
        extractParams: (match, question) => {
          // Prefer PO-YYYY-NNN format; fallback to po-xxx or YYYY-NNN at end (avoid capturing "i" etc.)
          const poMatch = question.match(/po-?(\d{4}-\d{2,})/i) || question.match(/po-?([a-z0-9\-]+)/i) || question.match(/(\d{4}-\d{2,})/);
          if (!poMatch || !poMatch[1]) return { poNumber: null };
          const value = poMatch[1].trim();
          const poNumber = value.toUpperCase().startsWith('PO') ? value : `PO-${value}`;
          return { poNumber };
        },
        description: 'Delete yarn purchase order'
      },
      {
        pattern: /(?:order\s+details?|show\s+purchase\s+order|purchase\s+order\s+details?|get\s+order)\s+(?:po-?)?[\w\-]+|(?:order|po)\s+by\s+id\s+[\w\-]+/i,
        action: 'getYarnPurchaseOrderById',
        extractParams: (match, question) => {
          const poMatch = question.match(/(?:po-?)?([a-z0-9\-]+)/i);
          const idMatch = question.match(/id\s+([a-f0-9]{24})/i);
          if (idMatch) return { purchaseOrderId: idMatch[1] };
          if (poMatch) return { poNumber: poMatch[0].toUpperCase().startsWith('PO') ? poMatch[0] : `PO-${poMatch[1]}` };
          return {};
        },
        description: 'Get single purchase order by PO number or ID'
      },
      // Edit order = order details (items, quantities), NOT status. "I wanna edit order", "edit order PO-xxx", "update an order"
      {
        pattern: /(?:i\s+)?(?:wanna|want\s+to)\s+edit\s+(?:the\s+)?order|edit\s+(?:the\s+)?(?:order\s+)?(?:details?\s+)?(?:for\s+)?(?:po-?)?[\w\-]*|edit\s+order\s+(?:po-?)?[\w\-]+/i,
        action: 'editYarnPurchaseOrder',
        extractParams: (match, question) => {
          const poMatch = question.match(/po-?(\d{4}-\d{2,})/i) || question.match(/po-?([a-z0-9\-]+)/i) || question.match(/(\d{4}-\d{2,})/);
          const idMatch = question.match(/id\s+([a-f0-9]{24})/i);
          if (idMatch) return { purchaseOrderId: idMatch[1] };
          if (poMatch && poMatch[1] && !/^(i|wanna|want|the|order|edit|details|for)$/i.test(poMatch[1].trim())) {
            const value = poMatch[1].trim();
            return { poNumber: value.toUpperCase().startsWith('PO') ? value : `PO-${value}` };
          }
          return {};
        },
        description: 'Edit yarn purchase order details (not status)'
      },
      // "Update an order" / "I wanna update a order" — same as edit (ask for PO number)
      {
        pattern: /(?:i\s+)?(?:wanna|want\s+to)\s+update\s+(?:an?\s+)?(?:the\s+)?order|update\s+(?:an?\s+)?(?:the\s+)?order\s*(?:\s+po-?[\w\-]+)?/i,
        action: 'editYarnPurchaseOrder',
        extractParams: (match, question) => {
          const poMatch = question.match(/po-?(\d{4}-\d{2,})/i) || question.match(/po-?([a-z0-9\-]+)/i) || question.match(/(\d{4}-\d{2,})/);
          const idMatch = question.match(/id\s+([a-f0-9]{24})/i);
          if (idMatch) return { purchaseOrderId: idMatch[1] };
          if (poMatch && poMatch[1]) return { poNumber: poMatch[1].toUpperCase().startsWith('PO') ? poMatch[1] : `PO-${poMatch[1]}` };
          return {};
        },
        description: 'Update order (edit order details — same as edit)'
      },
      // Quantity change (not status) — "update the quantity", "change quantity in order" → edit order, not update status
      {
        pattern: /(?:update|change)\s+(?:the\s+)?quantity\s+(?:in\s+)?(?:a\s+)?(?:purchase\s+)?order|(?:lets?\s+)?(?:change|update)\s+(?:the\s+)?quantity\s*\.?$/i,
        action: 'editYarnPurchaseOrder',
        extractParams: (match, question) => {
          const poMatch = question.match(/po-?(\d{4}-\d{2,})/i) || question.match(/po-?([a-z0-9\-]+)/i) || question.match(/(\d{4}-\d{2,})/);
          if (poMatch && poMatch[1]) return { poNumber: poMatch[1].toUpperCase().startsWith('PO') ? poMatch[1] : `PO-${poMatch[1]}` };
          return {};
        },
        description: 'Edit order quantity (treated as edit order, not status update)'
      },
      // Add item to order (when editing) — "i wanna add item", "add item", "i wanna add more yarn", "add more yarn"
      {
        pattern: /^(?:i\s+)?(?:wanna|want\s+to)\s+add\s+(?:an?\s+)?(?:item|more\s+yarn|more\s+items?)\s*\.?$|^add\s+(?:an?\s+)?(?:item|more\s+yarn|more\s+items?)\s*\.?$/i,
        action: 'editYarnPurchaseOrder',
        extractParams: () => ({}),
        description: 'Add an item to the order (when editing, shows only that order’s supplier yarn list)'
      },
      // Update STATUS only — user must say "update status", "mark as in transit", "goods received", etc.
      {
        pattern: /(?:update|change)\s+status\s+(?:of\s+)?(?:order\s+)?(?:po-?)?[\w\-]+|mark\s+(?:order\s+)?(?:po-?)?[\w\-]+\s+as\s+[\w\s]+|set\s+(?:order\s+)?(?:po-?)?[\w\-]+\s+to\s+[\w\s]+/i,
        action: 'updateYarnPurchaseOrderStatus',
        extractParams: (match, question) => {
          const poMatch = question.match(/po-?(\d{4}-\d{2,})/i) || question.match(/po-?([a-z0-9\-]+)/i) || question.match(/(\d{4}-\d{2,})/);
          const statusMatch = question.match(/(?:as|to)\s+([\w\s]+?)(?:\s|$|\.)/i) || question.match(/status\s+to\s+([\w\s]+)/i);
          const params = {};
          if (poMatch && poMatch[1]) params.poNumber = poMatch[1].toUpperCase().startsWith('PO') ? poMatch[1] : `PO-${poMatch[1]}`;
          if (statusMatch && statusMatch[1]) params.status_code = statusMatch[1].trim();
          return params;
        },
        description: 'Update yarn purchase order status (in transit, goods received, etc.)'
      },
      {
        pattern: /yarn\s+requisitions?|yarn\s+requests?|requisitions?\s+(?:for\s+)?yarn/i,
        action: 'getYarnRequisitions',
        extractParams: () => ({}),
        description: 'Get yarn requisitions'
      },
      {
        pattern: /yarn\s+issue|yarn\s+issued|issued\s+(?:yarn|cones?)|how\s+much\s+yarn\s+(?:has\s+been\s+|was\s+|is\s+)?issued|total\s+yarn\s+issued|yarn\s+(?:has\s+been\s+|was\s+)?issued/i,
        action: 'getYarnIssue',
        extractParams: (match, question) => {
          // Extract order number - handle various formats:
          // - "ORD-000001" or "ord-000001" (case insensitive)
          // - "by order ord-000001" or "by order ORD-000001"
          // - "order ORD-000001" or "order ord-000001"
          // - Just "ORD-000001" or "ord-000001"
          let orderNoMatch = question.match(/(?:by\s+)?order\s+(?:no|number)?\s*[:\-]?\s*(ord-?\d{6})/i) ||
                            question.match(/(?:by\s+)?order\s+(?:no|number)?\s*[:\-]?\s*([A-Z0-9\-]+)/i) ||
                            question.match(/(?:ORD-|ord-)?(\d{6})/i);
          
          let orderNumber = null;
          if (orderNoMatch) {
            // If we matched the full "ORD-000001" or "ord-000001" format
            if (orderNoMatch[0] && orderNoMatch[0].toLowerCase().startsWith('ord')) {
              // Normalize to uppercase ORD- format
              const orderPart = orderNoMatch[0].replace(/^.*ord-?/i, '').replace(/\D/g, '');
              if (orderPart.length === 6) {
                orderNumber = `ORD-${orderPart}`;
              } else {
                orderNumber = orderNoMatch[0].toUpperCase();
              }
            } else if (orderNoMatch[1] && /^\d{6}$/.test(orderNoMatch[1])) {
              // If we matched just the 6 digits
              orderNumber = `ORD-${orderNoMatch[1]}`;
            } else if (orderNoMatch[1] || orderNoMatch[0]) {
              // Use the matched value as-is
              orderNumber = (orderNoMatch[1] || orderNoMatch[0]).toUpperCase();
            }
          }
          
          return {
            orderNumber: orderNumber
          };
        },
        description: 'Get yarn issue records'
      },
      {
        pattern: /yarn\s+return|yarn\s+returned|returned\s+(?:yarn|cones?)/i,
        action: 'getYarnReturn',
        extractParams: () => ({}),
        description: 'Get yarn return records'
      },
      {
        pattern: /yarn\s+transactions?|yarn\s+history|transactions?\s+(?:for\s+)?yarn/i,
        action: 'getYarnTransactions',
        extractParams: () => ({}),
        description: 'Get yarn transactions'
      },
      {
        pattern: /live\s+inventory|live\s+yarn\s+inventory/i,
        action: 'getLiveInventory',
        extractParams: () => ({}),
        description: 'Get live inventory'
      },
      {
        pattern: /recent\s+po\s+status|recent\s+purchase\s+order\s+status|po\s+status/i,
        action: 'getRecentPOStatus',
        extractParams: () => ({}),
        description: 'Get recent PO status'
      },
      {
        pattern: /yarn\s+inventory|yarn\s+stock|yarn\s+quantity|inventory\s+(?:of\s+)?yarn/i,
        action: 'getYarnInventory',
        extractParams: () => ({}),
        description: 'Get yarn inventory'
      },
      {
        pattern: /(?:master\s+catalog\s+)?items?|products?\s+list|list\s+products?|show\s+products?|all\s+products?/i,
        action: 'getProductsList',
        extractParams: () => ({}),
        description: 'Get products list (Master Catalog Items)'
      },
      {
        pattern: /show\s+yarn\s+catalog\s+page\s+(\d+)|(?:show|get|list)\s+(?:yarn\s+)?catalog\s+page\s+(\d+)|(?:yarn\s+)?catalog\s+page\s+(\d+)|page\s+(\d+)\s+(?:yarn\s+)?catalog/i,
        action: 'getYarnCatalog',
        extractParams: (match) => {
          const page = parseInt(match[1] || match[2] || match[3] || match[4] || '1');
          console.log(`[detectIntent] Yarn catalog pagination - Extracted page parameter: ${page} from query, match groups:`, match);
          return { page };
        },
        description: 'Get yarn catalog with pagination'
      },
      {
        pattern: /yarn\s+catalog|show\s+yarn\s+catalog|list\s+yarn\s+catalog/i,
        action: 'getYarnCatalog',
        extractParams: () => ({}),
        description: 'Get yarn catalog'
      },
      {
        pattern: /yarn\s+types?|^types?$|list\s+yarn\s+types?|show\s+yarn\s+types?/i,
        action: 'getYarnTypes',
        extractParams: () => ({}),
        description: 'Get yarn types'
      },
      {
        pattern: /yarn\s+suppliers?|yarn\s+brands?|suppliers?|brands?/i,
        action: 'getYarnSuppliers',
        extractParams: () => ({}),
        description: 'Get yarn suppliers/brands'
      },
      {
        pattern: /yarn\s+count\s+sizes?|count\s+sizes?|yarn\s+count/i,
        action: 'getYarnCountSizes',
        extractParams: () => ({}),
        description: 'Get yarn count sizes'
      },
      {
        pattern: /yarn\s+colors?|colors?\s+(?:for\s+)?yarn/i,
        action: 'getYarnColors',
        extractParams: () => ({}),
        description: 'Get yarn colors'
      },
      {
        pattern: /yarn\s+blends?|blends?\s+(?:for\s+)?yarn|^blends?$/i,
        action: 'getYarnBlends',
        extractParams: () => ({}),
        description: 'Get yarn blends'
      },
      {
        pattern: /yarn\s+boxes?|boxes?\s+(?:for\s+)?yarn/i,
        action: 'getYarnBoxes',
        extractParams: () => ({}),
        description: 'Get yarn boxes'
      },
      {
        pattern: /yarn\s+cones?|cones?\s+(?:for\s+)?yarn/i,
        action: 'getYarnCones',
        extractParams: () => ({}),
        description: 'Get yarn cones'
      },
      // MACHINE PATTERNS - Status patterns MUST come before floor patterns
      {
        pattern: /(?:what|which|show\s+me|tell\s+me|list|get)\s+(?:the\s+)?(?:machines?\s+)?(?:that\s+are\s+|which\s+are\s+|are\s+)?(active|idle|under\s+maintenance)/i,
        action: 'getMachinesByStatus',
        extractParams: (match) => {
          const status = (match[1] || '').trim();
          if (status.toLowerCase() === 'under maintenance') {
            return { machineStatus: 'Under Maintenance' };
          }
          return { machineStatus: status.charAt(0).toUpperCase() + status.slice(1).toLowerCase() };
        },
        description: 'Get machines by status (what/which queries)'
      },
      {
        pattern: /(active|idle|under\s+maintenance)\s+machines?|machines?\s+(active|idle|under\s+maintenance)/i,
        action: 'getMachinesByStatus',
        extractParams: (match) => {
          const status = (match[1] || match[2] || '').trim();
          if (status.toLowerCase() === 'under maintenance') {
            return { machineStatus: 'Under Maintenance' };
          }
          return { machineStatus: status.charAt(0).toUpperCase() + status.slice(1).toLowerCase() };
        },
        description: 'Get machines by status'
      },
      {
        pattern: /machines?\s+(?:on|in|at)\s+(?:floor\s+)?([a-zA-Z0-9\s]+)|(?:floor\s+)([a-zA-Z0-9\s]+)\s+machines?|(?:show\s+)?machines?\s+(?:on|in|at)\s+(?:the\s+)?([a-zA-Z0-9\s]+)\s+floor/i,
        action: 'getMachinesByFloor',
        extractParams: (match) => {
          const floor = (match[1] || match[2] || match[3] || '').trim();
          // Don't match if it's a status word
          if (/^(active|idle|under\s+maintenance)$/i.test(floor)) {
            return null; // Return null to skip this match
          }
          // Normalize floor name: capitalize first letter of each word
          const normalizedFloor = floor.split(/\s+/).map(word => 
            word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
          ).join(' ');
          return { floor: normalizedFloor };
        },
        description: 'Get machines by floor'
      },
      {
        pattern: /machine\s+statistics?|machine\s+stats?|how\s+many\s+machines/i,
        action: 'getMachineStatistics',
        extractParams: () => ({}),
        description: 'Get machine statistics'
      },
      // RAW MATERIAL PATTERNS - Filtering patterns first (more specific)
      // COLOR PATTERN FIRST - Most common color words before "raw materials"
      {
        pattern: /(white|black|red|blue|green|yellow|orange|purple|pink|brown|grey|gray|beige|navy|cream|golden|gold|silver|transparent|dark\s+grey|light\s+grey|dark\s+gray|light\s+gray|maroon|olive|khaki|pastel\s+cream)\s+raw\s+materials?|raw\s+materials?\s+(?:color|colored)\s+(white|black|red|blue|green|yellow|orange|purple|pink|brown|grey|gray|beige|navy|cream|golden|gold|silver|transparent|dark\s+grey|light\s+grey|dark\s+gray|light\s+gray|maroon|olive|khaki|pastel\s+cream)/i,
        action: 'getRawMaterials',
        extractParams: (match) => {
          const color = (match[1] || match[2] || '').trim();
          if (color) {
            return { color };
          }
          return {};
        },
        description: 'Get raw materials by color'
      },
      {
        pattern: /raw\s+materials?\s+(?:color|colored)\s+([a-zA-Z0-9\s]+)|([a-zA-Z0-9\s]+)\s+(?:color|colored)\s+raw\s+materials?/i,
        action: 'getRawMaterials',
        extractParams: (match) => {
          const color = (match[1] || match[2] || '').trim();
          if (/^(show|list|get|all|the|page|by|in|of|with)$/i.test(color)) {
            return {};
          }
          return { color };
        },
        description: 'Get raw materials by color'
      },
      {
        pattern: /raw\s+materials?\s+(?:by|in|of|with)\s+(?:group\s+)?([a-zA-Z0-9\s]+)/i,
        action: 'getRawMaterials',
        extractParams: (match) => {
          const groupName = (match[1] || '').trim();
          // Skip if it's a common word that's not a group name
          if (/^(show|list|get|all|the|page|by|in|of|with|color|colored|type|brand)$/i.test(groupName)) {
            return {};
          }
          return { groupName };
        },
        description: 'Get raw materials by group'
      },
      {
        pattern: /raw\s+materials?\s+(?:type|of\s+type)\s+([a-zA-Z0-9\s]+)|([a-zA-Z0-9\s]+)\s+type\s+raw\s+materials?/i,
        action: 'getRawMaterials',
        extractParams: (match) => {
          const type = (match[1] || match[2] || '').trim();
          if (/^(show|list|get|all|the|page|by|in|of|with)$/i.test(type)) {
            return {};
          }
          return { type };
        },
        description: 'Get raw materials by type'
      },
      {
        pattern: /raw\s+materials?\s+(?:brand|by\s+brand)\s+([a-zA-Z0-9\s]+)|([a-zA-Z0-9\s]+)\s+brand\s+raw\s+materials?/i,
        action: 'getRawMaterials',
        extractParams: (match) => {
          const brand = (match[1] || match[2] || '').trim();
          if (/^(show|list|get|all|the|page|by|in|of|with)$/i.test(brand)) {
            return {};
          }
          return { brand };
        },
        description: 'Get raw materials by brand'
      },
      {
        pattern: /(?:show\s+)?raw\s+materials?\s+page\s+(\d+)|page\s+(\d+)\s+raw\s+materials?/i,
        action: 'getRawMaterials',
        extractParams: (match) => {
          const page = parseInt(match[1] || match[2] || '1');
          return { page };
        },
        description: 'Get raw materials with pagination'
      },
      {
        pattern: /raw\s+materials?|show\s+raw\s+materials?|list\s+raw\s+materials?/i,
        action: 'getRawMaterials',
        extractParams: () => ({}),
        description: 'Get raw materials'
      },
      {
        pattern: /processes?|show\s+processes?|list\s+processes?/i,
        action: 'getProcesses',
        extractParams: () => ({}),
        description: 'Get processes'
      },
      {
        pattern: /product\s+attributes?|attributes?|show\s+attributes?|list\s+attributes?/i,
        action: 'getProductAttributes',
        extractParams: () => ({}),
        description: 'Get product attributes'
      },
      {
        pattern: /categories?|show\s+categories?|list\s+categories?/i,
        action: 'getCategories',
        extractParams: () => ({}),
        description: 'Get categories'
      },
      {
        pattern: /storage\s+slots?|storage|slots?/i,
        action: 'getStorageSlots',
        extractParams: () => ({}),
        description: 'Get storage slots'
      }
    ];
    
    // Check critical patterns first
    console.log(`[detectIntent] Checking ${intents.length} critical patterns for: "${normalizedQuestion}"`);
    for (let i = 0; i < intents.length; i++) {
      const intent = intents[i];
      const match = normalizedQuestion.match(intent.pattern);
      if (match) {
        console.log(`[detectIntent] ✅ Pattern #${i} matched! Pattern: ${intent.pattern}, Action: ${intent.action}, Match: ${match[0]}`);
        const params = intent.extractParams ? intent.extractParams(match, normalizedQuestion) : {};
        if (params === null) {
          console.log(`[detectIntent] ⚠️ Pattern matched but extractParams returned null, skipping`);
          continue;
        }
        console.log(`[detectIntent] ✅ Returning intent: ${intent.action} for "${normalizedQuestion}"`);
        return {
          action: intent.action,
          params: params,
          description: intent.description,
          confidence: 0.9
        };
      }
    }
    // If critical keyword found but no pattern matched, log and continue to GPT detection
    console.log(`[detectIntent] ⚠️ Critical keyword found but NO regex pattern matched! Will try GPT detection for natural language understanding...`);
  }
  
  // ALWAYS try GPT-powered detection for natural language understanding
  // This allows GPT to handle natural language variations even for critical keywords
  console.log(`[detectIntent] Attempting GPT detection for natural language understanding: "${normalizedQuestion}"`);
  const aiIntent = await detectIntentWithAI(question, conversationHistory);
  if (aiIntent) {
    console.log(`[detectIntent] ✅ GPT detected intent: ${aiIntent.action} for "${normalizedQuestion}"`);
    return aiIntent;
  }
  console.log(`[detectIntent] ⚠️ GPT detection returned null or failed, will check fallback regex patterns below`);
  
  // Fallback to regex patterns if AI fails or was rejected
  
  // Intent patterns - ORDER MATTERS! More specific patterns first
  const intents = [
    // YARN PATTERNS (Highest Priority - Check First)
    {
      pattern: /yarn\s+purchase\s+orders?|yarn\s+po|purchase\s+orders?\s+(?:for\s+)?yarn|yarn\s+purchased|status\s+of\s+yarn\s+purchased|yarn\s+purchase\s+status|do\s+you\s+order\s+yarn|(?:what|show|tell)\s+me\s+(?:about\s+)?yarn\s+(?:purchase|order|po)/i,
      action: 'getYarnPurchaseOrders',
      extractParams: () => ({}),
      description: 'Get yarn purchase orders'
    },
    {
      pattern: /yarn\s+requisitions?|yarn\s+requests?|requisitions?\s+(?:for\s+)?yarn/i,
      action: 'getYarnRequisitions',
      extractParams: () => ({}),
      description: 'Get yarn requisitions'
    },
    {
      pattern: /yarn\s+transactions?|yarn\s+history|transactions?\s+(?:for\s+)?yarn/i,
      action: 'getYarnTransactions',
      extractParams: () => ({}),
      description: 'Get yarn transactions'
    },
    {
      pattern: /live\s+inventory|live\s+yarn\s+inventory/i,
      action: 'getLiveInventory',
      extractParams: () => ({}),
      description: 'Get live inventory'
    },
    {
      pattern: /recent\s+po\s+status|recent\s+purchase\s+order\s+status|po\s+status/i,
      action: 'getRecentPOStatus',
      extractParams: () => ({}),
      description: 'Get recent PO status'
    },
    {
      pattern: /yarn\s+inventory|yarn\s+stock|yarn\s+quantity|inventory\s+(?:of\s+)?yarn/i,
      action: 'getYarnInventory',
      extractParams: () => ({}),
      description: 'Get yarn inventory'
    },
    {
      pattern: /show\s+yarn\s+catalog\s+page\s+(\d+)|(?:show|get|list)\s+(?:yarn\s+)?catalog\s+page\s+(\d+)|(?:yarn\s+)?catalog\s+page\s+(\d+)|page\s+(\d+)\s+(?:yarn\s+)?catalog/i,
      action: 'getYarnCatalog',
      extractParams: (match) => {
        const page = parseInt(match[1] || match[2] || match[3] || match[4] || '1');
        console.log(`[detectIntent] Yarn catalog pagination - Extracted page parameter: ${page} from query, match groups:`, match);
        return { page };
      },
      description: 'Get yarn catalog with pagination'
    },
    {
      pattern: /yarn\s+catalog|show\s+yarn\s+catalog|list\s+yarn\s+catalog/i,
      action: 'getYarnCatalog',
      extractParams: () => ({}),
      description: 'Get yarn catalog'
    },
    {
      pattern: /^(yarn\s+types?|types?)$|yarn\s+types?|list\s+yarn\s+types?|show\s+yarn\s+types?|what\s+types?\s+(?:of\s+)?yarn|tell\s+me\s+(?:about\s+)?yarn\s+types?|what\s+yarn\s+types?/i,
      action: 'getYarnTypes',
      extractParams: () => ({}),
      description: 'Get yarn types'
    },
    {
      pattern: /yarn\s+types?\s+(?:with\s+)?(?:details?|subtypes?)\s+(.+)|yarn\s+types?\s+(?:having|with)\s+(?:details?|subtypes?)\s+(.+)/i,
      action: 'getYarnTypes',
      extractParams: (match) => ({ yarnSubtype: (match[1] || match[2] || '').trim() }),
      description: 'Get yarn types filtered by details/subtype'
    },
    {
      pattern: /yarn\s+types?\s+(?:named|called|with\s+name)\s+(.+)|yarn\s+type\s+(.+)/i,
      action: 'getYarnTypes',
      extractParams: (match) => ({ yarnTypeName: (match[1] || match[2] || '').trim() }),
      description: 'Get yarn types filtered by name'
    },
    {
      pattern: /(active|inactive)\s+yarn\s+types?|yarn\s+types?\s+(active|inactive)/i,
      action: 'getYarnTypes',
      extractParams: (match) => ({ status: (match[1] || match[2] || '').trim().toLowerCase() }),
      description: 'Get yarn types filtered by status'
    },
    {
      pattern: /yarn\s+suppliers?|yarn\s+brands?|suppliers?\s+(?:for\s+)?yarn|brands?\s+(?:for\s+)?yarn|what\s+suppliers?\s+(?:do\s+you\s+have\s+)?(?:for\s+)?yarn|tell\s+me\s+(?:about\s+)?yarn\s+suppliers?|what\s+yarn\s+suppliers?|what\s+yarn\s+brands?|what\s+yarn\s+brands?\s+(?:are\s+)?available/i,
      action: 'getYarnSuppliers',
      extractParams: () => ({}),
      description: 'Get yarn suppliers/brands'
    },
    {
      pattern: /yarn\s+count\s+sizes?|count\s+sizes?\s+(?:for\s+)?yarn|yarn\s+counts?|what\s+count\s+sizes?\s+(?:do\s+you\s+have\s+)?(?:in\s+)?yarn|tell\s+me\s+(?:about\s+)?yarn\s+count\s+sizes?|what\s+yarn\s+count\s+sizes?/i,
      action: 'getYarnCountSizes',
      extractParams: () => ({}),
      description: 'Get yarn count sizes'
    },
    {
      pattern: /yarn\s+colors?|yarn\s+colours?|colors?\s+(?:for\s+)?yarn|colours?\s+(?:for\s+)?yarn|what\s+colors?\s+(?:do\s+you\s+have\s+)?(?:in\s+)?yarn|what\s+colours?\s+(?:do\s+you\s+have\s+)?(?:in\s+)?yarn|tell\s+me\s+(?:about\s+)?(?:colours?|colors?)\s+(?:do\s+you\s+have\s+)?(?:in\s+)?yarn|can\s+you\s+tell\s+me\s+(?:about\s+)?(?:colours?|colors?)\s+(?:do\s+you\s+have\s+)?(?:in\s+)?yarn|what\s+(?:colours?|colors?)\s+(?:are\s+)?available\s+(?:in\s+)?yarn|show\s+me\s+yarn\s+(?:color|colour)\s+options?/i,
      action: 'getYarnColors',
      extractParams: () => ({}),
      description: 'Get yarn colors'
    },
    {
      pattern: /yarn\s+blends?|blends?\s+(?:for\s+)?yarn|^blends?$|what\s+blends?\s+(?:of\s+)?yarn|what\s+yarn\s+blends?|tell\s+me\s+(?:about\s+)?yarn\s+blends?|what\s+blends?\s+(?:do\s+you\s+have\s+)?(?:in\s+)?yarn|what\s+yarn\s+blends?\s+(?:are\s+)?available|show\s+me\s+yarn\s+blend\s+types?/i,
      action: 'getYarnBlends',
      extractParams: () => ({}),
      description: 'Get yarn blends'
    },
    // MACHINE PATTERNS (High Priority) - Status patterns MUST come before floor patterns
    {
      pattern: /(?:what|which|show\s+me|tell\s+me|list|get)\s+(?:the\s+)?(?:machines?\s+)?(?:that\s+are\s+|which\s+are\s+|are\s+)?(active|idle|under\s+maintenance)/i,
      action: 'getMachinesByStatus',
      extractParams: (match) => {
        const status = (match[1] || '').trim();
        if (status.toLowerCase() === 'under maintenance') {
          return { machineStatus: 'Under Maintenance' };
        }
        return { machineStatus: status.charAt(0).toUpperCase() + status.slice(1).toLowerCase() };
      },
      description: 'Get machines by status (what/which queries)'
    },
    {
      pattern: /(active|idle|under\s+maintenance)\s+machines?|machines?\s+(active|idle|under\s+maintenance)/i,
      action: 'getMachinesByStatus',
      extractParams: (match) => {
        const status = (match[1] || match[2] || '').trim();
        if (status.toLowerCase() === 'under maintenance') {
          return { machineStatus: 'Under Maintenance' };
        }
        return { machineStatus: status.charAt(0).toUpperCase() + status.slice(1).toLowerCase() };
      },
      description: 'Get machines by status'
    },
    {
      pattern: /machines?\s+(?:on|in|at)\s+(?:floor\s+)?([a-zA-Z0-9\s]+)|(?:floor\s+)([a-zA-Z0-9\s]+)\s+machines?|(?:show\s+)?machines?\s+(?:on|in|at)\s+(?:the\s+)?([a-zA-Z0-9\s]+)\s+floor/i,
      action: 'getMachinesByFloor',
      extractParams: (match) => {
        const floor = (match[1] || match[2] || match[3] || '').trim();
        // Don't match if it's a status word
        if (/^(active|idle|under\s+maintenance)$/i.test(floor)) {
          return null; // Return null to skip this match
        }
        // Normalize floor name: capitalize first letter of each word
        const normalizedFloor = floor.split(/\s+/).map(word => 
          word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        ).join(' ');
        return { floor: normalizedFloor };
      },
      description: 'Get machines by floor'
    },
    {
      pattern: /machine\s+statistics?|machine\s+stats?|how\s+many\s+machines/i,
      action: 'getMachineStatistics',
      extractParams: () => ({}),
      description: 'Get machine statistics'
    },
    // RAW MATERIAL PATTERNS - Filtering patterns first (High Priority)
    // COLOR PATTERN FIRST - Most common color words before "raw materials"
    {
      pattern: /(white|black|red|blue|green|yellow|orange|purple|pink|brown|grey|gray|beige|navy|cream|golden|gold|silver|transparent|dark\s+grey|light\s+grey|dark\s+gray|light\s+gray|maroon|olive|khaki|pastel\s+cream)\s+raw\s+materials?|raw\s+materials?\s+(?:color|colored)\s+(white|black|red|blue|green|yellow|orange|purple|pink|brown|grey|gray|beige|navy|cream|golden|gold|silver|transparent|dark\s+grey|light\s+grey|dark\s+gray|light\s+gray|maroon|olive|khaki|pastel\s+cream)/i,
      action: 'getRawMaterials',
      extractParams: (match) => {
        const color = (match[1] || match[2] || '').trim();
        if (color) {
          return { color };
        }
        return {};
      },
      description: 'Get raw materials by color'
    },
    {
      pattern: /raw\s+materials?\s+(?:color|colored)\s+([a-zA-Z0-9\s]+)|([a-zA-Z0-9\s]+)\s+(?:color|colored)\s+raw\s+materials?/i,
      action: 'getRawMaterials',
      extractParams: (match) => {
        const color = (match[1] || match[2] || '').trim();
        if (/^(show|list|get|all|the|page|by|in|of|with)$/i.test(color)) {
          return {};
        }
        return { color };
      },
      description: 'Get raw materials by color'
    },
    {
      pattern: /raw\s+materials?\s+(?:in|of|with)\s+([a-zA-Z0-9\s]+)/i,
      action: 'getRawMaterials',
      extractParams: (match) => {
        const potentialFilter = (match[1] || '').trim();
        // Check if it's a color word first
        const colorWords = ['white', 'black', 'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'brown', 'grey', 'gray', 'beige', 'navy', 'cream', 'golden', 'gold', 'silver', 'transparent', 'maroon', 'olive', 'khaki', 'tan', 'ivory', 'pearl', 'coral', 'teal', 'turquoise', 'lime', 'magenta', 'cyan', 'violet', 'indigo', 'amber', 'bronze', 'copper'];
        const lowerFilter = potentialFilter.toLowerCase();
        if (colorWords.includes(lowerFilter)) {
          return { color: lowerFilter };
        }
        // Skip if it's a common word that's not a filter
        if (/^(show|list|get|all|the|page|by|in|of|with|color|colored|type|brand|group)$/i.test(potentialFilter)) {
          return {};
        }
        // Otherwise treat as group name
        return { groupName: potentialFilter };
      },
      description: 'Get raw materials by color or group (checks color first)'
    },
    {
      pattern: /raw\s+materials?\s+by\s+(?:group\s+)?([a-zA-Z0-9\s]+)/i,
      action: 'getRawMaterials',
      extractParams: (match) => {
        const groupName = (match[1] || '').trim();
        // Skip if it's a common word that's not a group name
        if (/^(show|list|get|all|the|page|by|in|of|with|color|colored|type|brand)$/i.test(groupName)) {
          return {};
        }
        return { groupName };
      },
      description: 'Get raw materials by group'
    },
    {
      pattern: /([a-zA-Z0-9\s]+)\s+raw\s+materials?/i,
      action: 'getRawMaterials',
      extractParams: (match) => {
        const potentialGroup = (match[1] || '').trim();
        // Skip if it's a common word
        if (/^(show|list|get|all|the|page|by|in|of|with|color|colored|type|brand)$/i.test(potentialGroup)) {
          return {};
        }
        // Skip if it's a known color word (colors are handled by the color pattern above)
        const colorWords = ['white', 'black', 'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'brown', 'grey', 'gray', 'beige', 'navy', 'cream', 'golden', 'gold', 'silver', 'transparent', 'maroon', 'olive', 'khaki'];
        if (colorWords.includes(potentialGroup.toLowerCase())) {
          return null; // Return null to skip this match, let color pattern handle it
        }
        // Otherwise treat as group name
        return { groupName: potentialGroup };
      },
      description: 'Get raw materials by group (fallback)'
    },
    {
      pattern: /([a-zA-Z0-9\s]+)\s+raw\s+materials?/i,
      action: 'getRawMaterials',
      extractParams: (match) => {
        const potentialGroup = (match[1] || '').trim();
        // Skip if it's a common word
        if (/^(show|list|get|all|the|page|by|in|of|with|color|colored|type|brand)$/i.test(potentialGroup)) {
          return {};
        }
        // Skip if it's a known color word (colors are handled by the color pattern above)
        const colorWords = ['white', 'black', 'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'brown', 'grey', 'gray', 'beige', 'navy', 'cream', 'golden', 'gold', 'silver', 'transparent', 'maroon', 'olive', 'khaki'];
        if (colorWords.includes(potentialGroup.toLowerCase())) {
          return null; // Return null to skip this match, let color pattern handle it
        }
        // Otherwise treat as group name
        return { groupName: potentialGroup };
      },
      description: 'Get raw materials by group (fallback)'
    },
    {
      pattern: /raw\s+materials?\s+(?:type|of\s+type)\s+([a-zA-Z0-9\s]+)|([a-zA-Z0-9\s]+)\s+type\s+raw\s+materials?/i,
      action: 'getRawMaterials',
      extractParams: (match) => {
        const type = (match[1] || match[2] || '').trim();
        if (/^(show|list|get|all|the|page|by|in|of|with)$/i.test(type)) {
          return {};
        }
        return { type };
      },
      description: 'Get raw materials by type'
    },
    {
      pattern: /raw\s+materials?\s+(?:brand|by\s+brand)\s+([a-zA-Z0-9\s]+)|([a-zA-Z0-9\s]+)\s+brand\s+raw\s+materials?/i,
      action: 'getRawMaterials',
      extractParams: (match) => {
        const brand = (match[1] || match[2] || '').trim();
        if (/^(show|list|get|all|the|page|by|in|of|with)$/i.test(brand)) {
          return {};
        }
        return { brand };
      },
      description: 'Get raw materials by brand'
    },
    {
      pattern: /(?:show\s+)?raw\s+materials?\s+page\s+(\d+)|page\s+(\d+)\s+raw\s+materials?/i,
      action: 'getRawMaterials',
      extractParams: (match) => {
        const page = parseInt(match[1] || match[2] || '1');
        return { page };
      },
      description: 'Get raw materials with pagination'
    },
    {
      pattern: /(?:what|show|tell|list|get|any)\s+(?:other|available|all)?\s*(?:colors?|colours?)\s+(?:available|in|for|of)?\s*(?:raw\s+materials?)?|(?:any|other)\s+(?:other|available)?\s*(?:colors?|colours?)\s+(?:available|in|for|of)?\s*(?:raw\s+materials?)?|raw\s+materials?\s+(?:available|other)?\s*(?:colors?|colours?)|(?:colors?|colours?)\s+(?:available|in|for)\s+raw\s+materials?/i,
      action: 'getRawMaterialColors',
      extractParams: () => ({}),
      description: 'Get available colors in raw materials'
    },
    {
      pattern: /raw\s+materials?|show\s+raw\s+materials?|list\s+raw\s+materials?/i,
      action: 'getRawMaterials',
      extractParams: () => ({}),
      description: 'Get raw materials'
    },
    {
      pattern: /processes?|show\s+processes?|list\s+processes?/i,
      action: 'getProcesses',
      extractParams: () => ({}),
      description: 'Get processes'
    },
    {
      pattern: /product\s+attributes?|attributes?|show\s+attributes?|list\s+attributes?/i,
      action: 'getProductAttributes',
      extractParams: () => ({}),
      description: 'Get product attributes'
    },
    // PRODUCTION PATTERNS
    {
      pattern: /production\s+dashboard|production\s+overview|production\s+stats/i,
      action: 'getProductionDashboard',
      extractParams: () => ({}),
      description: 'Get production dashboard'
    },
    {
      pattern: /production\s+orders?|production\s+list/i,
      action: 'getProductionOrders',
      extractParams: () => ({}),
      description: 'Get production orders'
    },
    // PRODUCT PATTERNS (Lower Priority - Check After Yarn/Machine)
    {
      pattern: /top\s+products\s+(?:in\s+)?([a-zA-Z\s,]+)/i,
      action: 'getTopProductsInCity',
      extractParams: (match) => ({ city: match[1].trim() }),
      description: 'Get top products in a specific city'
    },
    {
      pattern: /top\s+\d*\s*products/i,
      action: 'getTopProducts',
      extractParams: () => ({}),
      description: 'Get top products across all stores'
    },
    {
      pattern: /(?:how\s+many\s+)?products?\s+(?:do\s+we\s+have|count|total)|product\s+count|total\s+products/i,
      action: 'getProductCount',
      extractParams: () => ({}),
      description: 'Get total product count'
    },
    {
      pattern: /sales\s+report|sales\s+summary|sales\s+trend|monthly\s+sales\s+report/i,
      action: 'getSalesReport',
      extractParams: () => ({}),
      description: 'Get sales report (aggregated)'
    },
    {
      pattern: /sales\s+for\s+(?:product\s+)?(.+?)(?:\s+in\s+[a-zA-Z]+|\s+from|\s+to|$)/i,
      action: 'getSalesData',
      extractParams: (match, q) => {
        const productPart = (match[1] || '').trim();
        const cityMatch = (q || '').match(/sales\s+for\s+(?:product\s+)?(.+?)\s+in\s+([a-zA-Z\s,]+)/i);
        const params = { productName: cityMatch ? cityMatch[1].trim() : productPart };
        if (cityMatch && cityMatch[2]) params.city = cityMatch[2].trim();
        return params;
      },
      description: 'Get sales data for product (optional city)'
    },
    {
      pattern: /sales\s+(?:in|for)\s+([a-zA-Z\s,]+?)(?:\s+from|\s+to|$)/i,
      action: 'getSalesData',
      extractParams: (match) => ({ city: match[1].trim() }),
      description: 'Get sales data filtered by city'
    },
    {
      pattern: /sales\s+(?:from|between)\s+([^\s]+(?:\s+[^\s]+)?)\s+(?:to|and)\s+([^\s]+(?:\s+[^\s]+)?)/i,
      action: 'getSalesData',
      extractParams: (match) => ({ dateFrom: match[1].trim(), dateTo: match[2].trim() }),
      description: 'Get sales data by date range'
    },
    {
      pattern: /sales\s+at\s+(?:store\s+)?([a-zA-Z0-9\s\-]+?)(?:\s+from|\s+to|$)/i,
      action: 'getSalesData',
      extractParams: (match) => ({ storeName: match[1].trim() }),
      description: 'Get sales data by store'
    },
    {
      pattern: /(?:show\s+me\s+)?(?:all\s+)?sales\s+data|sales\s+records?|sales\s+transactions?|list\s+sales/i,
      action: 'getSalesData',
      extractParams: () => ({}),
      description: 'Get sales data (transaction list)'
    },
    {
      pattern: /analytics\s+dashboard|dashboard|business\s+insights/i,
      action: 'getAnalyticsDashboard',
      extractParams: () => ({}),
      description: 'Get comprehensive analytics dashboard'
    },
    {
      pattern: /store\s+analysis|store\s+performance|store\s+report/i,
      action: 'getStoreAnalysis',
      extractParams: () => ({}),
      description: 'Get store performance analysis'
    },
    {
      pattern: /products\s+in\s+([a-zA-Z\s,]+)/i,
      action: 'getTopProductsInCity',
      extractParams: (match) => ({ city: match[1].trim() }),
      description: 'Get products in a specific city'
    },
    {
      pattern: /best\s+selling\s+products/i,
      action: 'getTopProducts',
      extractParams: () => ({}),
      description: 'Get best selling products'
    },
    {
      pattern: /inventory\s+summary|product\s+inventory/i,
      action: 'getProductCount',
      extractParams: () => ({}),
      description: 'Get product inventory summary'
    },
    {
      pattern: /sales\s+trend|trend\s+for|monthly\s+sales/i,
      action: 'getSalesReport',
      extractParams: () => ({}),
      description: 'Get sales trend analysis'
    },
    {
      pattern: /top\s+stores|stores\s+by\s+performance|store\s+ranking/i,
      action: 'getStoreAnalysis',
      extractParams: () => ({}),
      description: 'Get top stores by performance'
    },
    {
      pattern: /brand\s+performance|brand\s+data|brand\s+analysis|show\s+me\s+brand/i,
      action: 'getBrandPerformance',
      extractParams: () => ({}),
      description: 'Get brand performance analysis'
    },
    {
      pattern: /(?:next\s+)?(?:month|months?)\s+(?:sales\s+)?forecast\s+(?:for\s+)?([^?]+?)(?:\s+in\s+([a-zA-Z\s,]+))?/i,
      action: 'getProductForecast',
      extractParams: (match) => ({ 
        productName: match[1].trim(),
        city: match[2] ? match[2].trim() : null
      }),
      description: 'Get sales forecast for specific product and city'
    },
    {
      pattern: /(?:what\s+are\s+)?(?:your\s+)?(?:potential\s+)?use\s+cases?|capabilities?|what\s+can\s+you\s+do/i,
      action: 'getCapabilities',
      extractParams: () => ({}),
      description: 'Get system capabilities and use cases'
    },
    {
      pattern: /^article\s+[a-z0-9]+|article\s+[a-z0-9]+\s*$/i,
      action: 'getArticleById',
      extractParams: (match, question) => {
        // Extract article ID or article number
        const articleMatch = question.match(/article\s+([a-z0-9]+)/i);
        return {
          articleId: articleMatch ? articleMatch[1] : null
        };
      },
      description: 'Get article by ID or article number'
    },
    {
      pattern: /(?:give\s+me\s+)?([^?]+?)\s+analysis|analyze\s+([^?]+?)/i,
      action: 'getProductAnalysis',
      extractParams: (match, question) => {
        const name = (match[1] || match[2] || '').trim().toLowerCase();
        const lowerQuestion = (question || '').toLowerCase();
        // Skip if it's yarn, machine, production, order, raw material, process, attribute, blend, or article related
        const skipKeywords = ['yarn', 'machine', 'production', 'order', 'raw material', 'process', 'attribute', 'blend', 'blends', 'types', 'suppliers', 'colors', 'count size', 'count sizes', 'article'];
        const hasSkipKeyword = skipKeywords.some(keyword => 
          name.includes(keyword) || lowerQuestion.includes(keyword)
        );
        if (hasSkipKeyword) {
          return null; // Return null to skip this pattern
        }
        return { productName: (match[1] || match[2]).trim() };
      },
      description: 'Get detailed product analysis by name'
    },
    {
      pattern: /(?:store\s+)?([a-zA-Z]{3,}[a-zA-Z0-9\s\-]*?)\s+(?:store|data|performance|analysis)/i,
      action: 'getStoreAnalysisByName',
      extractParams: (match) => ({ 
        storeName: match[1].trim()
      }),
      description: 'Get store analysis by store name with context'
    },
    // Machine patterns - Status patterns MUST come before floor patterns
    {
      pattern: /machine\s+statistics?|machine\s+stats?|how\s+many\s+machines/i,
      action: 'getMachineStatistics',
      extractParams: () => ({}),
      description: 'Get machine statistics and counts'
    },
    {
      pattern: /(?:what|which|show\s+me|tell\s+me|list|get)\s+(?:the\s+)?(?:machines?\s+)?(?:that\s+are\s+|which\s+are\s+|are\s+)?(active|idle|under\s+maintenance)/i,
      action: 'getMachinesByStatus',
      extractParams: (match) => {
        const status = (match[1] || '').trim();
        if (status.toLowerCase() === 'under maintenance') {
          return { machineStatus: 'Under Maintenance' };
        }
        return { machineStatus: status.charAt(0).toUpperCase() + status.slice(1).toLowerCase() };
      },
      description: 'Get machines by status (what/which queries)'
    },
    {
      pattern: /(active|idle|under\s+maintenance)\s+machines?|machines?\s+(active|idle|under\s+maintenance)/i,
      action: 'getMachinesByStatus',
      extractParams: (match) => {
        const status = (match[1] || match[2] || '').trim();
        if (status.toLowerCase() === 'under maintenance') {
          return { machineStatus: 'Under Maintenance' };
        }
        return { machineStatus: status.charAt(0).toUpperCase() + status.slice(1).toLowerCase() };
      },
      description: 'Get machines by status'
    },
    {
      pattern: /(?:machines?\s+)?(?:on|in|at)\s+(?:floor\s+)?([a-zA-Z0-9\s]+)|(?:show\s+)?machines?\s+(?:on|in|at)\s+(?:the\s+)?([a-zA-Z0-9\s]+)\s+floor/i,
      action: 'getMachinesByFloor',
      extractParams: (match) => {
        const floor = (match[1] || match[2] || '').trim();
        // Don't match if it's a status word
        if (/^(active|idle|under\s+maintenance)$/i.test(floor)) {
          return null; // Return null to skip this match
        }
        // Normalize floor name: capitalize first letter of each word
        const normalizedFloor = floor.split(/\s+/).map(word => 
          word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        ).join(' ');
        return { floor: normalizedFloor };
      },
      description: 'Get machines by floor'
    },
    // Yarn patterns
    {
      pattern: /yarn\s+catalog|show\s+yarn|list\s+yarn/i,
      action: 'getYarnCatalog',
      extractParams: () => ({}),
      description: 'Get yarn catalog'
    },
    {
      pattern: /live\s+inventory|live\s+yarn\s+inventory/i,
      action: 'getLiveInventory',
      extractParams: () => ({}),
      description: 'Get live inventory'
    },
    {
      pattern: /recent\s+po\s+status|recent\s+purchase\s+order\s+status|po\s+status/i,
      action: 'getRecentPOStatus',
      extractParams: () => ({}),
      description: 'Get recent PO status'
    },
    {
      pattern: /yarn\s+inventory|yarn\s+stock|yarn\s+quantity/i,
      action: 'getYarnInventory',
      extractParams: () => ({}),
      description: 'Get yarn inventory'
    },
    {
      pattern: /yarn\s+transactions?|yarn\s+history/i,
      action: 'getYarnTransactions',
      extractParams: () => ({}),
      description: 'Get yarn transactions'
    },
    {
      pattern: /yarn\s+requisitions?|yarn\s+requests?/i,
      action: 'getYarnRequisitions',
      extractParams: () => ({}),
      description: 'Get yarn requisitions'
    },
    {
      pattern: /yarn\s+purchase\s+orders?|yarn\s+po|yarn\s+purchased|status\s+of\s+yarn\s+purchased|yarn\s+purchase\s+status|do\s+you\s+order\s+yarn|(?:what|show|tell)\s+me\s+(?:about\s+)?yarn\s+(?:purchase|order|po)/i,
      action: 'getYarnPurchaseOrders',
      extractParams: () => ({}),
      description: 'Get yarn purchase orders'
    },
    // Production patterns - articles by order should come before generic orders
    {
      pattern: /articles?\s+(?:for|in|by)\s+order|order\s+(?:no|number)?\s*[:\-]?\s*(?:ord-?\d+|ord-?[a-z0-9]+)\s+articles?/i,
      action: 'getArticlesByOrder',
      extractParams: (match, question) => {
        // Extract order number - more flexible matching
        let orderNoMatch = question.match(/articles?\s+(?:for|in|by)\s+order\s+(?:no|number)?\s*[:\-]?\s*(ord-?\d+)/i) ||
                          question.match(/articles?\s+(?:for|in|by)\s+order\s+(?:no|number)?\s*[:\-]?\s*(ord-?[a-z0-9]+)/i) ||
                          question.match(/order\s+(?:no|number)?\s*[:\-]?\s*(ord-?\d+)/i) ||
                          question.match(/order\s+(?:no|number)?\s*[:\-]?\s*(ord-?[a-z0-9]+)/i);
        
        let orderNumber = null;
        if (orderNoMatch) {
          const matched = orderNoMatch[1] || orderNoMatch[0];
          if (matched) {
            // Normalize to uppercase and ensure ORD- prefix
            const normalized = matched.toUpperCase().trim();
            if (normalized.startsWith('ORD-')) {
              // Extract digits and pad to 6 digits
              const digits = normalized.replace(/^ORD-?/i, '').replace(/\D/g, '');
              if (digits) {
                orderNumber = `ORD-${digits.padStart(6, '0')}`;
              } else {
                orderNumber = normalized;
              }
            } else if (normalized.startsWith('ORD')) {
              const digits = normalized.replace(/^ORD/i, '').replace(/\D/g, '');
              if (digits) {
                orderNumber = `ORD-${digits.padStart(6, '0')}`;
              } else {
                orderNumber = `ORD-${normalized}`;
              }
            } else if (/^\d+$/.test(normalized)) {
              orderNumber = `ORD-${normalized.padStart(6, '0')}`;
            } else {
              orderNumber = normalized;
            }
          }
        }
        
        return {
          orderNumber: orderNumber
        };
      },
      description: 'Get articles by order number'
    },
    {
      pattern: /^article\s+[a-z0-9]+|article\s+[a-z0-9]+\s*$/i,
      action: 'getArticleById',
      extractParams: (match, question) => {
        // Extract article ID or article number
        const articleMatch = question.match(/article\s+([a-z0-9]+)/i);
        return {
          articleId: articleMatch ? articleMatch[1] : null
        };
      },
      description: 'Get article by ID or article number'
    },
    {
      pattern: /production\s+orders?|production\s+list/i,
      action: 'getProductionOrders',
      extractParams: () => ({}),
      description: 'Get production orders'
    },
    {
      pattern: /production\s+dashboard|production\s+overview|production\s+stats/i,
      action: 'getProductionDashboard',
      extractParams: () => ({}),
      description: 'Get production dashboard'
    },
    {
      pattern: /orders?\s+(?:list|status|details)/i,
      action: 'getOrders',
      extractParams: () => ({}),
      description: 'Get orders'
    }
  ];
  
  // Check each intent pattern
  for (const intent of intents) {
    const match = normalizedQuestion.match(intent.pattern);
    if (match) {
      // Extract params - some extractParams functions may return null to skip
      const params = intent.extractParams ? intent.extractParams(match, normalizedQuestion) : {};
      if (params === null) {
        // Skip this pattern if extractParams returns null
        continue;
      }
      return {
        action: intent.action,
        params: params,
        description: intent.description,
        confidence: 0.9
      };
    }
  }
  
  return null;
};

/**
 * CSS styles for AI tool responses
 */
const AI_TOOL_STYLES = `
<style>
.ai-tool-response {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  margin: 12px 0;
  padding: 12px;
  background-color: #fff;
  border-radius: 12px;
  border: 1px solid #e5e7eb;
}

.ai-tool-response h3 {
  margin: 0 0 8px 0;
  color: #000;
  font-size: 13px;
  font-weight: 600;
}

.city-info, .report-info {
  background-color: #fff;
  padding: 10px;
  border-radius: 12px;
  margin-bottom: 10px;
  border: 1px solid #e5e7eb;
}

.city-info p, .report-info p {
  margin: 4px 0;
  color: #000;
  font-size: 12px;
}

.city-info strong, .report-info strong {
  color: #000;
}

.table-container {
  margin: 10px 0;
  overflow-x: auto;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  background-color: #fff;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid #e5e7eb;
}

.data-table th,
.data-table td {
  padding: 8px 10px;
  text-align: left;
  border-bottom: 1px solid #e5e7eb;
  color: #000;
}

.data-table th {
  background-color: #f3f4f6;
  color: #000;
  font-weight: 600;
  font-size: 11px;
}

.data-table tr:hover {
  background-color: #f9fafb;
}

.data-table tr:nth-child(even) {
  background-color: #fafafa;
}

.summary-card {
  display: inline-block;
  margin: 6px;
  padding: 10px 12px;
  min-width: 90px;
  text-align: center;
  background-color: #fff;
  border-radius: 12px;
  border: 1px solid #e5e7eb;
}

.card-content h3 {
  margin: 0 0 4px 0;
  font-size: 11px;
  font-weight: 500;
  color: #000;
}

.card-value {
  font-size: 16px;
  font-weight: 600;
  margin: 4px 0;
  color: #000;
}

.card-subtitle {
  font-size: 10px;
  color: #374151;
}

.summary {
  margin-top: 10px;
  padding: 8px;
  background-color: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  color: #000;
  font-size: 12px;
  text-align: center;
}

.response-content {
  background-color: #fff;
  padding: 10px;
  border-radius: 12px;
  border: 1px solid #e5e7eb;
}

.response-content p {
  margin: 6px 0;
  color: #000;
  line-height: 1.5;
  font-size: 12px;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
  gap: 8px;
  margin: 10px 0;
}

.kpi-item {
  background-color: #fff;
  padding: 10px;
  border-radius: 12px;
  text-align: center;
  border: 1px solid #e5e7eb;
}

.kpi-label {
  font-size: 10px;
  color: #374151;
  margin-bottom: 2px;
}

.kpi-value {
  font-size: 14px;
  font-weight: 600;
  color: #000;
  margin-bottom: 2px;
}

.kpi-change {
  font-size: 10px;
  font-weight: 600;
}

.kpi-change.positive { color: #16a34a; }
.kpi-change.negative { color: #dc2626; }

.chart-container {
  margin: 10px 0;
  padding: 10px;
  background-color: #fff;
  border-radius: 12px;
  border: 1px solid #e5e7eb;
}

.chart-container h4 {
  margin: 0 0 8px 0;
  color: #000;
  font-size: 12px;
  font-weight: 600;
}
</style>
`;

/**
 * Get top products across all stores or filtered by city using analytics service
 * @param {string} city - Optional city filter
 * @returns {Promise<string>} HTML string with top products data
 */
export const getTopProducts = async (city = null) => {
  try {
    console.log(`[getTopProducts] Called with city: ${city}`);
    
    // Build store filter
    let storeFilter = {};
    let storeIds = [];
    
    if (city) {
      const cityName = city.trim();
      console.log(`[getTopProducts] Searching for stores in city: ${cityName}`);
      storeFilter.city = { $regex: cityName, $options: 'i' };
      
      // Get stores in the city
      const stores = await Store.find(storeFilter).select('_id storeName city').lean();
      console.log(`[getTopProducts] Found ${stores.length} stores in ${cityName}`);
      
      if (stores.length === 0) {
        // Try to find similar city names
        const allCities = await Store.distinct('city');
        const similarCities = allCities.filter(c => 
          c && (c.toLowerCase().includes(cityName.toLowerCase()) || 
          cityName.toLowerCase().includes(c.toLowerCase()))
        ).slice(0, 5);
        
        let errorMsg = `No stores found in "${cityName}".`;
        if (similarCities.length > 0) {
          errorMsg += ` Did you mean: ${similarCities.join(', ')}?`;
        } else {
          errorMsg += ` Available cities include: ${allCities.slice(0, 10).join(', ')}${allCities.length > 10 ? '...' : ''}`;
        }
        return generateHTMLResponse('No Stores Found', errorMsg);
      }
      
      storeIds = stores.map(store => store._id);
      console.log(`[getTopProducts] Using ${storeIds.length} store IDs for filtering`);
    }
    
    // Build sales match filter
    let salesMatchFilter = {};
    if (storeIds.length > 0) {
      salesMatchFilter.plant = { $in: storeIds };
      console.log(`[getTopProducts] Filtering sales by ${storeIds.length} stores`);
    }
    
    // Query top products directly from sales data with better product lookup
    const topProducts = await Sales.aggregate([
      { $match: salesMatchFilter },
      {
        $lookup: {
          from: 'products',
          localField: 'materialCode',
          foreignField: '_id',
          as: 'productData'
        }
      },
      { $unwind: { path: '$productData', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'categories',
          localField: 'productData.category',
          foreignField: '_id',
          as: 'categoryData'
        }
      },
      {
        $unwind: {
          path: '$categoryData',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $group: {
          _id: '$materialCode',
          productName: { 
            $first: { 
              $ifNull: [
                '$productData.name', 
                { $concat: ['Product ', { $toString: '$materialCode' }] }
              ] 
            } 
          },
          materialCodeId: { $first: '$materialCode' },
          productCode: { $first: { $ifNull: ['$productData.softwareCode', '$productData.styleCode', 'N/A'] } },
          styleCode: { $first: { $ifNull: ['$productData.styleCode', 'N/A'] } },
          categoryName: { $first: { $ifNull: ['$categoryData.name', 'Uncategorized'] } },
          totalQuantity: { $sum: '$quantity' },
          totalNSV: { $sum: '$nsv' },
          totalGSV: { $sum: '$gsv' },
          totalDiscount: { $sum: '$discount' },
          avgMRP: { $avg: '$mrp' },
          recordCount: { $sum: 1 }
        }
      },
      { $sort: { totalNSV: -1 } },
      { $limit: 10 }
    ]);
    
    console.log(`[getTopProducts] Found ${topProducts.length} products`);
    if (topProducts.length > 0) {
      console.log(`[getTopProducts] Sample product:`, JSON.stringify(topProducts[0], null, 2));
      
      // Post-process: Try to find products that weren't found in the lookup
      for (let product of topProducts) {
        if (!product.productName || product.productName.startsWith('Product ')) {
          // Try to find the product directly by ID
          try {
            const foundProduct = await Product.findById(product._id).select('name softwareCode styleCode category').lean();
            if (foundProduct) {
              product.productName = foundProduct.name;
              product.productCode = foundProduct.softwareCode || foundProduct.styleCode || product.productCode;
              product.styleCode = foundProduct.styleCode || product.styleCode;
              
              // Get category name
              if (foundProduct.category) {
                try {
                  const category = await categoryService.getCategoryById(foundProduct.category);
                  if (category && category.name) {
                    product.categoryName = category.name;
                  }
                } catch (catErr) {
                  console.log(`[getTopProducts] Could not find category for product ${product._id}`);
                }
              }
              console.log(`[getTopProducts] Found product ${product._id}: ${product.productName}`);
            }
          } catch (err) {
            console.log(`[getTopProducts] Could not find product ${product._id}:`, err.message);
          }
        }
      }
    }
    
    if (topProducts.length === 0) {
      let errorMsg = 'No sales transactions found for the specified criteria.';
      if (city) {
        errorMsg = `No sales data found for stores in "${city}".`;
        // Re-check stores to provide helpful message
        const stores = await Store.find({ city: { $regex: city.trim(), $options: 'i' } }).select('storeName city').limit(5).lean();
        if (stores.length > 0) {
          errorMsg += ` Found ${stores.length} store(s) in this city but no sales data.`;
        }
      }
      return generateHTMLResponse('No Sales Data Found', errorMsg);
    }
    
    // Calculate summary statistics
    const totalNSV = topProducts.reduce((sum, p) => sum + (p.totalNSV || 0), 0);
    const totalGSV = topProducts.reduce((sum, p) => sum + (p.totalGSV || 0), 0);
    const totalQuantity = topProducts.reduce((sum, p) => sum + (p.totalQuantity || 0), 0);
    const totalDiscount = topProducts.reduce((sum, p) => sum + (p.totalDiscount || 0), 0);
    const totalOrders = topProducts.reduce((sum, p) => sum + (p.recordCount || 0), 0);
    const avgOrderValue = totalOrders > 0 ? totalNSV / totalOrders : 0;
    
    // Get overall sales stats for the city
    const overallStats = await Sales.aggregate([
      { $match: salesMatchFilter },
      {
        $group: {
          _id: null,
          totalSalesNSV: { $sum: '$nsv' },
          totalSalesGSV: { $sum: '$gsv' },
          totalSalesQuantity: { $sum: '$quantity' },
          totalSalesDiscount: { $sum: '$discount' },
          totalSalesOrders: { $sum: 1 }
        }
      }
    ]);
    
    const overall = overallStats.length > 0 ? overallStats[0] : {
      totalSalesNSV: 0,
      totalSalesGSV: 0,
      totalSalesQuantity: 0,
      totalSalesDiscount: 0,
      totalSalesOrders: 0
    };
    
    const stores = storeIds.length > 0 
      ? await Store.find({ _id: { $in: storeIds } }).select('storeName city').lean()
      : [];
    
    // Generate HTML with summary KPIs
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>🏆 Top Products ${city ? `in ${city}` : 'Across All Stores'}</h3>
        ${city ? `<div class="city-info"><p><strong>City:</strong> ${city}</p><p><strong>Stores:</strong> ${stores.length}</p></div>` : ''}
        
        <div class="kpi-grid">
          <div class="kpi-item">
            <div class="kpi-label">Total Sales (NSV)</div>
            <div class="kpi-value">₹${overall.totalSalesNSV.toLocaleString()}</div>
            <div class="kpi-change">All Products</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Total Quantity</div>
            <div class="kpi-value">${overall.totalSalesQuantity.toLocaleString()}</div>
            <div class="kpi-change">Units Sold</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Total Orders</div>
            <div class="kpi-value">${overall.totalSalesOrders.toLocaleString()}</div>
            <div class="kpi-change">Transactions</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Average Order Value</div>
            <div class="kpi-value">₹${(overall.totalSalesOrders > 0 ? overall.totalSalesNSV / overall.totalSalesOrders : 0).toFixed(2)}</div>
            <div class="kpi-change">Per Transaction</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Top 10 Products Share</div>
            <div class="kpi-value">${overall.totalSalesNSV > 0 ? ((totalNSV / overall.totalSalesNSV) * 100).toFixed(1) : 0}%</div>
            <div class="kpi-change">Of Total NSV</div>
          </div>
        </div>
        
        <div class="chart-container">
          <h4>📊 Top 10 Products</h4>
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Product Name</th>
                  <th>Code</th>
                  <th>Category</th>
                  <th>Quantity Sold</th>
                  <th>Total NSV (₹)</th>
                  <th>Total GSV (₹)</th>
                  <th>Discount (₹)</th>
                  <th>Avg MRP (₹)</th>
                  <th>Orders</th>
                </tr>
              </thead>
              <tbody>
                ${topProducts.map((product, index) => `
                  <tr>
                    <td>${index + 1}</td>
                    <td>${product.productName || `Product ${product._id}`}</td>
                    <td>${product.productCode || product.styleCode || 'N/A'}</td>
                    <td>${product.categoryName || 'Uncategorized'}</td>
                    <td>${(product.totalQuantity || 0).toLocaleString()}</td>
                    <td>₹${(product.totalNSV || 0).toLocaleString()}</td>
                    <td>₹${(product.totalGSV || 0).toLocaleString()}</td>
                    <td>₹${(product.totalDiscount || 0).toLocaleString()}</td>
                    <td>₹${(product.avgMRP || 0).toFixed(2)}</td>
                    <td>${product.recordCount || 0}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        
        <p class="summary">
          Found ${topProducts.length} top performing products ${city ? `in ${city}` : 'across all stores'}. 
          Top 10 products represent ${overall.totalSalesNSV > 0 ? ((totalNSV / overall.totalSalesNSV) * 100).toFixed(1) : 0}% of total sales (₹${totalNSV.toLocaleString()} of ₹${overall.totalSalesNSV.toLocaleString()}).
        </p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getTopProducts:', error);
    return generateHTMLResponse('Error', `Failed to retrieve top products: ${error.message}`);
  }
};

/**
 * Get total product count using product service
 * @returns {Promise<string>} HTML string with product count
 */
export const getProductCount = async () => {
  try {
    const products = await productService.queryProducts({}, { limit: 1 });
    const totalProducts = products.totalResults || 0;
    
    // Get additional product statistics
    const activeProducts = await productService.queryProducts({ status: 'active' }, { limit: 1 });
    const activeCount = activeProducts.totalResults || 0;
    
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>📦 Product Inventory Summary</h3>
        <div class="kpi-grid">
          <div class="kpi-item">
            <div class="kpi-label">Total Products</div>
            <div class="kpi-value">${totalProducts.toLocaleString()}</div>
            <div class="kpi-change">Available in System</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Active Products</div>
            <div class="kpi-value">${activeCount.toLocaleString()}</div>
            <div class="kpi-change">Currently Active</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Inactive Products</div>
            <div class="kpi-value">${(totalProducts - activeCount).toLocaleString()}</div>
            <div class="kpi-change">Not Active</div>
          </div>
        </div>
        <p class="summary">Your inventory currently contains ${totalProducts.toLocaleString()} products with ${activeCount.toLocaleString()} active items.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getProductCount:', error);
    return generateHTMLResponse('Error', `Failed to retrieve product count: ${error.message}`);
  }
};

/**
 * Get products list (Master Catalog Items)
 * @param {Object} params - Parameters
 * @returns {Promise<string>} HTML string with products list
 */
export const getProductsList = async (params = {}) => {
  try {
    const { 
      limit = 50, 
      page = 1, 
      productName, 
      category, 
      name, 
      softwareCode, 
      internalCode, 
      vendorCode, 
      factoryCode, 
      knittingCode,
      styleCode, 
      eanCode, 
      status 
    } = params;
    const currentPage = parseInt(page) || 1;
    const pageLimit = parseInt(limit) || 50;
    
    // Build filter object - support ALL fields
    const filter = {};
    if (productName) {
      filter.name = { $regex: productName, $options: 'i' };
    }
    if (name && !productName) {
      filter.name = { $regex: name, $options: 'i' };
    }
    if (category) {
      // Category can be ID or name - try both
      if (category.match(/^[0-9a-fA-F]{24}$/)) {
        filter.category = category;
      } else {
        // If it's a name, we'll need to populate category
        filter['category.name'] = { $regex: category, $options: 'i' };
      }
    }
    if (softwareCode) {
      filter.softwareCode = { $regex: softwareCode, $options: 'i' };
    }
    if (internalCode) {
      filter.internalCode = { $regex: internalCode, $options: 'i' };
    }
    if (vendorCode) {
      filter.vendorCode = { $regex: vendorCode, $options: 'i' };
    }
    if (factoryCode) {
      filter.factoryCode = { $regex: factoryCode, $options: 'i' };
    }
    if (knittingCode) {
      filter.knittingCode = { $regex: knittingCode, $options: 'i' };
    }
    if (styleCode) {
      filter.styleCode = { $regex: styleCode, $options: 'i' };
    }
    if (eanCode) {
      filter.eanCode = { $regex: eanCode, $options: 'i' };
    }
    if (status) {
      filter.status = status.toLowerCase();
    }
    
    const products = await productService.queryProducts(filter, { 
      limit: pageLimit,
      page: currentPage
    });
    
    if (!products.results || products.results.length === 0) {
      const filterSummary = Object.keys(filter).length > 0 
        ? ` matching filters: ${Object.keys(filter).join(', ')}` 
        : '';
      return generateHTMLResponse('No Products Found', `No products found${filterSummary}.`);
    }
    
    const totalCount = products.totalResults || products.results.length;
    const totalPages = products.totalPages || Math.ceil(totalCount / pageLimit);
    const activeCount = products.results.filter(p => p.status === 'active' || p.status === 'Active').length;
    const inactiveCount = products.results.filter(p => p.status === 'inactive' || p.status === 'Inactive').length;
    const categories = [...new Set(products.results.map(p => p.category?.name || p.category).filter(Boolean))];
    
    // Build filter summary
    const appliedFilters = [];
    if (productName || name) appliedFilters.push(`Name: ${productName || name}`);
    if (category) appliedFilters.push(`Category: ${category}`);
    if (softwareCode) appliedFilters.push(`Software Code: ${softwareCode}`);
    if (internalCode) appliedFilters.push(`Internal Code: ${internalCode}`);
    if (vendorCode) appliedFilters.push(`Vendor Code: ${vendorCode}`);
    if (factoryCode) appliedFilters.push(`Factory Code: ${factoryCode}`);
    if (styleCode) appliedFilters.push(`Style Code: ${styleCode}`);
    if (eanCode) appliedFilters.push(`EAN Code: ${eanCode}`);
    if (status) appliedFilters.push(`Status: ${status}`);
    const filterSummaryHTML = appliedFilters.length > 0 
      ? `<p style="margin: 10px 0; padding: 10px; background: #e3f2fd; border-radius: 4px; color: #1976d2;"><strong>Filters Applied:</strong> ${appliedFilters.join(', ')}</p>` 
      : '';
    
    const paginationHTML = generatePaginationHTML(currentPage, totalPages, totalCount, 'products');
    
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>📦 Master Catalog Items</h3>
        ${filterSummaryHTML}
        
        <div class="kpi-grid">
          <div class="kpi-item">
            <div class="kpi-label">Total Products</div>
            <div class="kpi-value">${totalCount.toLocaleString()}</div>
            <div class="kpi-change">In System</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Active Products</div>
            <div class="kpi-value">${activeCount.toLocaleString()}</div>
            <div class="kpi-change">Currently Active</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Categories</div>
            <div class="kpi-value">${categories.length}</div>
            <div class="kpi-change">Unique Categories</div>
          </div>
        </div>
        
        <div class="chart-container">
          <h4>📋 Products List ${totalPages > 1 ? `(Page ${currentPage} of ${totalPages})` : ''}</h4>
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Style Code</th>
                  <th>Internal Code</th>
                  <th>Category</th>
                  <th>Factory Code</th>
                  <th>Created At</th>
                </tr>
              </thead>
              <tbody>
                ${products.results.map((product) => `
                  <tr>
                    <td>${product.name || 'N/A'}</td>
                    <td>${product.styleCode || 'N/A'}</td>
                    <td>${product.internalCode || 'N/A'}</td>
                    <td>${product.category?.name || product.category || 'N/A'}</td>
                    <td>${product.factoryCode || 'N/A'}</td>
                    <td>${product.createdAt ? new Date(product.createdAt).toLocaleDateString() : 'N/A'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        
        ${paginationHTML}
        
        <p class="summary">Found ${totalCount.toLocaleString()} products${totalPages > 1 ? ` (showing page ${currentPage} of ${totalPages}, ${products.results.length} items per page)` : ''} across ${categories.length} categories with ${activeCount} active items.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getProductsList:', error);
    return generateHTMLResponse('Error', `Failed to retrieve products list: ${error.message}`);
  }
};

/**
 * Get stores list
 * @param {Object} params - Parameters
 * @returns {Promise<string>} HTML string with stores list
 */
export const getStoresList = async (params = {}) => {
  try {
    const { 
      limit = 50, 
      page = 1, 
      city, 
      status, 
      storeName, 
      storeId, 
      bpCode, 
      brand, 
      state, 
      pincode 
    } = params;
    const currentPage = parseInt(page) || 1;
    const pageLimit = parseInt(limit) || 50;
    
    // Build filter object - support ALL fields
    const filter = {};
    if (city) {
      filter.city = { $regex: city, $options: 'i' };
    }
    if (storeName) {
      filter.storeName = { $regex: storeName, $options: 'i' };
    }
    if (storeId) {
      filter.storeId = { $regex: storeId, $options: 'i' };
    }
    if (bpCode) {
      filter.bpCode = { $regex: bpCode, $options: 'i' };
    }
    if (brand) {
      filter.brand = { $regex: brand, $options: 'i' };
    }
    if (state) {
      filter.state = { $regex: state, $options: 'i' };
    }
    if (pincode) {
      filter.pincode = { $regex: pincode, $options: 'i' };
    }
    if (status !== undefined && status !== null) {
      // Handle status: 'active', 'inactive', true, false, 'true', 'false'
      if (status === 'active' || status === true || status === 'true') {
        filter.isActive = true;
      } else if (status === 'inactive' || status === false || status === 'false') {
        filter.isActive = false;
      }
    }
    
    const stores = await storeService.queryStores(filter, { 
      limit: pageLimit,
      page: currentPage
    });
    
    if (!stores.results || stores.results.length === 0) {
      return generateHTMLResponse('No Stores Found', 'No stores found in the system.');
    }
    
    const totalCount = stores.totalResults || stores.results.length;
    const totalPages = stores.totalPages || Math.ceil(totalCount / pageLimit);
    const activeCount = stores.results.filter(s => s.isActive === true).length;
    const inactiveCount = stores.results.filter(s => s.isActive === false).length;
    const cities = [...new Set(stores.results.map(s => s.city).filter(Boolean))];
    
    const paginationHTML = generatePaginationHTML(currentPage, totalPages, totalCount, 'stores');
    
    // Build filter summary - include ALL applied filters
    const filterInfo = [];
    if (city) filterInfo.push(`City: ${city}`);
    if (storeName) filterInfo.push(`Store Name: ${storeName}`);
    if (storeId) filterInfo.push(`Store ID: ${storeId}`);
    if (bpCode) filterInfo.push(`BP Code: ${bpCode}`);
    if (brand) filterInfo.push(`Brand: ${brand}`);
    if (state) filterInfo.push(`State: ${state}`);
    if (pincode) filterInfo.push(`Pincode: ${pincode}`);
    if (status !== undefined && status !== null) {
      const statusText = (status === 'active' || status === true || status === 'true') ? 'Active' : 'Inactive';
      filterInfo.push(`Status: ${statusText}`);
    }
    const filterText = filterInfo.length > 0 ? ` (Filtered: ${filterInfo.join(', ')})` : '';
    const filterSummaryHTML = filterInfo.length > 0 
      ? `<p style="margin: 10px 0; padding: 10px; background: #e3f2fd; border-radius: 4px; color: #1976d2;"><strong>Filters Applied:</strong> ${filterInfo.join(', ')}</p>` 
      : '';
    
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>🏪 Stores List${filterText}</h3>
        ${filterSummaryHTML}
        
        <div class="kpi-grid">
          <div class="kpi-item">
            <div class="kpi-label">Total Stores</div>
            <div class="kpi-value">${totalCount.toLocaleString()}</div>
            <div class="kpi-change">${filterInfo.length > 0 ? 'Filtered Results' : 'In System'}</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Active Stores</div>
            <div class="kpi-value">${activeCount.toLocaleString()}</div>
            <div class="kpi-change">Currently Active</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Cities</div>
            <div class="kpi-value">${cities.length}</div>
            <div class="kpi-change">Unique Cities</div>
          </div>
        </div>
        
        <div class="chart-container">
          <h4>📋 Stores List ${totalPages > 1 ? `(Page ${currentPage} of ${totalPages})` : ''}</h4>
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Store ID</th>
                  <th>Store Name</th>
                  <th>City</th>
                  <th>Address</th>
                  <th>Contact Person</th>
                  <th>Contact Email</th>
                  <th>Contact Phone</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${stores.results.map((store) => `
                  <tr>
                    <td>${store.storeId || 'N/A'}</td>
                    <td>${store.storeName || 'N/A'}</td>
                    <td>${store.city || 'N/A'}</td>
                    <td>${store.addressLine1 || 'N/A'}${store.addressLine2 ? `, ${store.addressLine2}` : ''}</td>
                    <td>${store.contactPerson || 'N/A'}</td>
                    <td>${store.contactEmail || 'N/A'}</td>
                    <td>${store.contactPhone || 'N/A'}</td>
                    <td><span style="color: ${store.isActive ? '#10b981' : '#ef4444'}; font-weight: 600;">${store.isActive ? 'Active' : 'Inactive'}</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        
        ${paginationHTML}
        
        <p class="summary">Found ${totalCount.toLocaleString()} stores${filterText ? ` matching filters` : ''}${totalPages > 1 ? ` (showing page ${currentPage} of ${totalPages}, ${stores.results.length} items per page)` : ''}${cities.length > 0 ? ` across ${cities.length} cities` : ''}${activeCount > 0 ? ` with ${activeCount} active stores` : ''}.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getStoresList:', error);
    return generateHTMLResponse('Error', `Failed to retrieve stores list: ${error.message}`);
  }
};

/**
 * Get top products in a specific city using analytics service
 * @param {string} city - City name
 * @returns {Promise<string>} HTML string with top products in city
 */
export const getTopProductsInCity = async (city) => {
  try {
    if (!city) {
      return generateHTMLResponse('City Required', 'Please specify a city to get top products.');
    }
    
    // Find stores in the city
    const stores = await Store.find({ 
      city: { $regex: city, $options: 'i' } 
    }).select('_id storeName city').lean();
    
    if (stores.length === 0) {
      return generateHTMLResponse('No Stores Found', `No stores found in ${city}. Please check the city name.`);
    }
    
    const storeIds = stores.map(store => store._id);
    
    // Get sales data for top products in the city using analytics service
    const salesData = await Sales.aggregate([
      { $match: { plant: { $in: storeIds } } },
      {
        $lookup: {
          from: 'products',
          localField: 'materialCode',
          foreignField: '_id',
          as: 'productData'
        }
      },
      { $unwind: '$productData' },
      {
        $lookup: {
          from: 'categories',
          localField: 'productData.category',
          foreignField: '_id',
          as: 'categoryData'
        }
      },
      {
        $unwind: {
          path: '$categoryData',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $group: {
          _id: '$materialCode',
          productName: { $first: '$productData.name' },
          softwareCode: { $first: '$productData.softwareCode' },
          categoryName: { $first: '$categoryData.name' },
          totalQuantity: { $sum: '$quantity' },
          totalSales: { $sum: '$gsv' },
          totalRevenue: { $sum: '$nsv' },
          totalDiscount: { $sum: '$discount' },
          storeCount: { $addToSet: '$plant' }
        }
      },
      {
        $addFields: {
          storeCount: { $size: '$storeCount' }
        }
      },
      { $sort: { totalSales: -1 } },
      { $limit: 10 }
    ]);
    
    if (salesData.length === 0) {
      return generateHTMLResponse('No Sales Data', `No sales transactions found for stores in ${city}.`);
    }
    
    // Generate HTML table
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>🏆 Top Products in ${city}</h3>
        <div class="city-info">
          <p><strong>City:</strong> ${city}</p>
          <p><strong>Stores:</strong> ${stores.length}</p>
        </div>
        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Product Name</th>
                <th>Code</th>
                <th>Category</th>
                <th>Quantity Sold</th>
                <th>Total Sales (₹)</th>
                <th>Revenue (₹)</th>
                <th>Discount (₹)</th>
                <th>Stores Selling</th>
              </tr>
            </thead>
            <tbody>
              ${salesData.map((product, index) => `
                <tr>
                  <td>${index + 1}</td>
                  <td>${product.productName || 'Unknown'}</td>
                  <td>${product.softwareCode || 'N/A'}</td>
                  <td>${product.categoryName || 'Unknown'}</td>
                  <td>${product.totalQuantity.toLocaleString()}</td>
                  <td>₹${product.totalSales.toLocaleString()}</td>
                  <td>₹${product.totalRevenue.toLocaleString()}</td>
                  <td>₹${product.totalDiscount.toLocaleString()}</td>
                  <td>${product.storeCount}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <p class="summary">Found ${salesData.length} top performing products in ${city} across ${stores.length} stores.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getTopProductsInCity:', error);
    return generateHTMLResponse('Error', `Failed to retrieve top products in ${city}: ${error.message}`);
  }
};

/**
 * Get sales report with various parameters using analytics service
 * @param {Object} params - Report parameters
 * @returns {Promise<string>} HTML string with sales report
 */
export const getSalesReport = async (params = {}) => {
  try {
    const { 
      dateFrom, 
      dateTo, 
      city, 
      category, 
      limit,
      period,
      groupBy = 'product'
    } = params;
    
    // Set default date range if not provided (last 30 days)
    let startDate = dateFrom ? new Date(dateFrom) : null;
    let endDate = dateTo ? new Date(dateTo) : null;
    
    // Handle period parameter if provided
    if (period && !dateFrom && !dateTo) {
      const now = new Date();
      endDate = new Date(now);
      
      switch (period.toLowerCase()) {
        case 'today':
          startDate = new Date(now);
          startDate.setHours(0, 0, 0, 0);
          endDate.setHours(23, 59, 59, 999);
          break;
        case 'yesterday':
          startDate = new Date(now);
          startDate.setDate(startDate.getDate() - 1);
          startDate.setHours(0, 0, 0, 0);
          endDate = new Date(startDate);
          endDate.setHours(23, 59, 59, 999);
          break;
        case 'lastweek':
        case 'last week':
          startDate = new Date(now);
          startDate.setDate(startDate.getDate() - 7);
          break;
        case 'lastmonth':
        case 'last month':
          startDate = new Date(now);
          startDate.setMonth(startDate.getMonth() - 1);
          break;
        case 'last30days':
        case 'last 30 days':
        default:
          startDate = new Date(now);
          startDate.setDate(startDate.getDate() - 30);
          break;
      }
    } else if (!startDate && !endDate) {
      // Default to actual data range from database if no date range specified
      // Get the actual date range of sales data
      const dateRange = await Sales.aggregate([
        {
          $group: {
            _id: null,
            minDate: { $min: '$date' },
            maxDate: { $max: '$date' }
          }
        }
      ]);
      
      if (dateRange.length > 0 && dateRange[0].minDate && dateRange[0].maxDate) {
        // Use actual data range
        endDate = new Date(dateRange[0].maxDate);
        startDate = new Date(dateRange[0].minDate);
        console.log(`[getSalesReport] Using actual data range: ${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}`);
      } else {
        // Fallback to last 30 days from today
        const now = new Date();
        endDate = new Date(now);
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 30);
      }
    } else if (!startDate) {
      // If only end date provided, go back 30 days
      startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 30);
    } else if (!endDate) {
      // If only start date provided, use the latest date in database or today (whichever is earlier)
      const latestDate = await Sales.findOne().sort({ date: -1 }).select('date').lean();
      if (latestDate && latestDate.date) {
        endDate = new Date(latestDate.date);
      } else {
        endDate = new Date();
      }
    }
    
    // Ensure dates are valid and not beyond actual data
    const actualDateRange = await Sales.aggregate([
      {
        $group: {
          _id: null,
          minDate: { $min: '$date' },
          maxDate: { $max: '$date' }
        }
      }
    ]);
    
    if (actualDateRange.length > 0 && actualDateRange[0].maxDate) {
      const maxDataDate = new Date(actualDateRange[0].maxDate);
      if (endDate > maxDataDate) {
        endDate = new Date(maxDataDate);
      }
      if (startDate > maxDataDate) {
        startDate = new Date(actualDateRange[0].minDate || maxDataDate);
      }
    }
    
    // Ensure start date doesn't exceed end date
    if (startDate > endDate) {
      startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 30);
    }
    
    // Set default limit if not provided or invalid
    const reportLimit = parseInt(limit) || 20;
    
    // Build filter
    let filter = {};
    let storeFilter = {};
    
    if (city) {
      const cityName = city.trim();
      storeFilter.city = { $regex: cityName, $options: 'i' };
      console.log(`[getSalesReport] Filtering by city: ${cityName}`);
    }
    
    // Get stores if city filter is applied
    let storeIds = null;
    if (Object.keys(storeFilter).length > 0) {
      const stores = await Store.find(storeFilter).select('_id storeName city').lean();
      console.log(`[getSalesReport] Found ${stores.length} stores matching city filter`);
      if (stores.length === 0) {
        // Try to find similar city names
        const allCities = await Store.distinct('city');
        const similarCities = allCities.filter(c => 
          c && (c.toLowerCase().includes(city.trim().toLowerCase()) || 
          city.trim().toLowerCase().includes(c.toLowerCase()))
        ).slice(0, 5);
        
        let errorMsg = `No stores found in "${city}".`;
        if (similarCities.length > 0) {
          errorMsg += ` Did you mean: ${similarCities.join(', ')}?`;
        }
        return generateHTMLResponse('No Stores Found', errorMsg);
      }
      storeIds = stores.map(store => store._id);
      console.log(`[getSalesReport] Using ${storeIds.length} store IDs for filtering`);
    }
    
    // Build base match filter for sales data
    const baseMatch = {
      date: {
        $gte: startDate,
        $lte: endDate
      }
    };
    
    if (storeIds && storeIds.length > 0) {
      baseMatch.plant = { $in: storeIds };
      console.log(`[getSalesReport] Filtering sales by ${storeIds.length} stores`);
    }
    
    console.log(`[getSalesReport] Date range: ${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}`);
    
    // Get summary KPIs first
    const summaryKPIs = await Sales.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: null,
          totalQuantity: { $sum: '$quantity' },
          totalNSV: { $sum: '$nsv' },
          totalGSV: { $sum: '$gsv' },
          totalDiscount: { $sum: '$discount' },
          totalTax: { $sum: '$totalTax' },
          totalOrders: { $sum: 1 },
          avgOrderValue: { $avg: '$nsv' }
        }
      }
    ]);
    
    const summary = summaryKPIs.length > 0 ? summaryKPIs[0] : {
      totalQuantity: 0,
      totalNSV: 0,
      totalGSV: 0,
      totalDiscount: 0,
      totalTax: 0,
      totalOrders: 0,
      avgOrderValue: 0
    };
    
    let reportData = null;
    let columns = [];
    let tableData = [];
    
    // Use direct database queries instead of analytics service
    if (groupBy === 'product') {
      // Get product performance data directly
      reportData = await Sales.aggregate([
        { $match: baseMatch },
        {
          $lookup: {
            from: 'products',
            localField: 'materialCode',
            foreignField: '_id',
            as: 'productData'
          }
        },
        { $unwind: '$productData' },
        {
          $lookup: {
            from: 'categories',
            localField: 'productData.category',
            foreignField: '_id',
            as: 'categoryData'
          }
        },
        {
          $unwind: {
            path: '$categoryData',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $group: {
            _id: '$materialCode',
            productName: { $first: '$productData.name' },
            productCode: { $first: '$productData.softwareCode' },
            categoryName: { $first: { $ifNull: ['$categoryData.name', 'Unknown Category'] } },
            totalQuantity: { $sum: '$quantity' },
            totalNSV: { $sum: '$nsv' },
            totalGSV: { $sum: '$gsv' },
            totalDiscount: { $sum: '$discount' },
            recordCount: { $sum: 1 }
          }
        },
        { $sort: { totalNSV: -1 } },
        { $limit: reportLimit }
      ]);
      
      columns = ['Rank', 'Product Name', 'Code', 'Category', 'Quantity', 'NSV (₹)', 'GSV (₹)', 'Discount (₹)', 'Orders'];
      tableData = reportData.map((item, index) => [
        index + 1,
        item.productName || 'Unknown',
        item.productCode || 'N/A',
        item.categoryName || 'Unknown',
        (item.totalQuantity || 0).toLocaleString(),
        `₹${(item.totalNSV || 0).toLocaleString()}`,
        `₹${(item.totalGSV || 0).toLocaleString()}`,
        `₹${(item.totalDiscount || 0).toLocaleString()}`,
        item.recordCount || 0
      ]);
      
    } else if (groupBy === 'store') {
      // Get store performance data directly
      reportData = await Sales.aggregate([
        { $match: baseMatch },
        {
          $lookup: {
            from: 'stores',
            localField: 'plant',
            foreignField: '_id',
            as: 'storeData'
          }
        },
        { $unwind: '$storeData' },
        {
          $group: {
            _id: '$storeData._id',
            storeName: { $first: '$storeData.storeName' },
            storeId: { $first: '$storeData.storeId' },
            city: { $first: '$storeData.city' },
            totalQuantity: { $sum: '$quantity' },
            totalNSV: { $sum: '$nsv' },
            totalGSV: { $sum: '$gsv' },
            totalDiscount: { $sum: '$discount' },
            totalTax: { $sum: '$totalTax' },
            recordCount: { $sum: 1 }
          }
        },
        { $sort: { totalNSV: -1 } },
        { $limit: reportLimit }
      ]);
      
      columns = ['Rank', 'Store Name', 'Store ID', 'City', 'Quantity', 'NSV (₹)', 'GSV (₹)', 'Discount (₹)', 'Tax (₹)', 'Orders'];
      tableData = reportData.map((item, index) => [
        index + 1,
        item.storeName || 'Unknown',
        item.storeId || 'N/A',
        item.city || 'Unknown',
        (item.totalQuantity || 0).toLocaleString(),
        `₹${(item.totalNSV || 0).toLocaleString()}`,
        `₹${(item.totalGSV || 0).toLocaleString()}`,
        `₹${(item.totalDiscount || 0).toLocaleString()}`,
        `₹${(item.totalTax || 0).toLocaleString()}`,
        item.recordCount || 0
      ]);
      
    } else if (groupBy === 'date') {
      // Get time-based sales trends directly
      reportData = await Sales.aggregate([
        { $match: baseMatch },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: '%Y-%m-%d', date: '$date' } }
            },
            totalQuantity: { $sum: '$quantity' },
            totalNSV: { $sum: '$nsv' },
            totalGSV: { $sum: '$gsv' },
            totalDiscount: { $sum: '$discount' },
            totalTax: { $sum: '$totalTax' },
            recordCount: { $sum: 1 }
          }
        },
        { $sort: { '_id.date': 1 } },
        { $limit: reportLimit }
      ]);
      
      columns = ['Rank', 'Date', 'Quantity', 'NSV (₹)', 'GSV (₹)', 'Discount (₹)', 'Tax (₹)', 'Orders'];
      tableData = reportData.map((item, index) => [
        index + 1,
        item._id.date,
        (item.totalQuantity || 0).toLocaleString(),
        `₹${(item.totalNSV || 0).toLocaleString()}`,
        `₹${(item.totalGSV || 0).toLocaleString()}`,
        `₹${(item.totalDiscount || 0).toLocaleString()}`,
        `₹${(item.totalTax || 0).toLocaleString()}`,
        item.recordCount || 0
      ]);
    }
    
    // Generate table HTML with summary KPIs
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>📊 Sales Report</h3>
        
        <!-- Summary KPIs -->
        <div class="kpi-grid">
          <div class="kpi-item">
            <div class="kpi-label">Total Sales (NSV)</div>
            <div class="kpi-value">₹${(summary.totalNSV || 0).toLocaleString()}</div>
            <div class="kpi-change">Net Sales Value</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Total Orders</div>
            <div class="kpi-value">${(summary.totalOrders || 0).toLocaleString()}</div>
            <div class="kpi-change">Transactions</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Total Quantity</div>
            <div class="kpi-value">${(summary.totalQuantity || 0).toLocaleString()}</div>
            <div class="kpi-change">Units Sold</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Total Discount</div>
            <div class="kpi-value">₹${(summary.totalDiscount || 0).toLocaleString()}</div>
            <div class="kpi-change">Discounts Applied</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Average Order Value</div>
            <div class="kpi-value">₹${(summary.avgOrderValue || 0).toFixed(2)}</div>
            <div class="kpi-change">Per Transaction</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Total GSV</div>
            <div class="kpi-value">₹${(summary.totalGSV || 0).toLocaleString()}</div>
            <div class="kpi-change">Gross Sales Value</div>
          </div>
        </div>
        
        <div class="chart-container">
          <h4>📋 Sales Report Details</h4>
          <div class="report-info" style="margin-bottom: 15px; padding: 10px; background: rgba(51, 65, 85, 0.5); border-radius: 6px;">
            <p style="margin: 5px 0; color: #e2e8f0;"><strong>Grouped by:</strong> ${groupBy}</p>
            ${city ? `<p style="margin: 5px 0; color: #e2e8f0;"><strong>City:</strong> ${city}</p>` : ''}
            ${category ? `<p style="margin: 5px 0; color: #e2e8f0;"><strong>Category:</strong> ${category}</p>` : ''}
            <p style="margin: 5px 0; color: #e2e8f0;"><strong>Date Range:</strong> ${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}</p>
            <p style="margin: 5px 0; color: #e2e8f0;"><strong>Results:</strong> ${reportData && reportData.length > 0 ? reportData.length : 0} records</p>
          </div>
          
          ${reportData && reportData.length > 0 ? `
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    ${columns.map(col => `<th>${col}</th>`).join('')}
                  </tr>
                </thead>
                <tbody>
                  ${tableData.map(row => `
                    <tr>
                      ${row.map(cell => `<td>${cell}</td>`).join('')}
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          ` : `
            <div style="padding: 20px; text-align: center; color: #94a3b8;">
              <p>No sales data found for the specified criteria.</p>
              <p style="font-size: 0.9em; margin-top: 10px;">Try adjusting the date range or filters.</p>
            </div>
          `}
        </div>
        
        <p class="summary">Sales report generated for ${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}${city ? ` in ${city}` : ''}${reportData && reportData.length > 0 ? ` with ${reportData.length} ${groupBy} records` : ''}.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getSalesReport:', error);
    return generateHTMLResponse('Error', `Failed to generate sales report: ${error.message}`);
  }
};

/**
 * Get city-specific analytics data
 * @param {string} city - City name
 * @param {Object} filter - Additional filters
 * @returns {Promise<Object>} City analytics data
 */
const getCitySpecificAnalytics = async (city, filter = {}) => {
  try {
    // Find all stores in the specified city
    const storesInCity = await Store.find({ 
      city: { $regex: city, $options: 'i' } 
    }).select('_id').lean();
    
    if (storesInCity.length === 0) {
      return null;
    }
    
    const storeIds = storesInCity.map(store => store._id);
    
    // Build date filter
    let dateFilter = {};
    if (filter.dateFrom || filter.dateTo) {
      dateFilter.date = {};
      if (filter.dateFrom) dateFilter.date.$gte = new Date(filter.dateFrom);
      if (filter.dateTo) dateFilter.date.$lte = new Date(filter.dateTo);
    }
    
    // Get city summary KPIs
    const summaryKPIs = await Sales.aggregate([
      {
        $match: {
          plant: { $in: storeIds },
          ...dateFilter
        }
      },
      {
        $group: {
          _id: null,
          totalQuantity: { $sum: '$quantity' },
          totalNSV: { $sum: '$nsv' },
          totalGSV: { $sum: '$gsv' },
          totalDiscount: { $sum: '$discount' },
          totalTax: { $sum: '$totalTax' },
          totalOrders: { $sum: 1 }
        }
      }
    ]);
    
    // Get top products in city
    const topProducts = await Sales.aggregate([
      {
        $match: {
          plant: { $in: storeIds },
          ...dateFilter
        }
      },
      {
        $lookup: {
          from: 'products',
          localField: 'materialCode',
          foreignField: '_id',
          as: 'product'
        }
      },
      {
        $unwind: '$product'
      },
      {
        $lookup: {
          from: 'categories',
          localField: 'product.category',
          foreignField: '_id',
          as: 'category'
        }
      },
      {
        $unwind: {
          path: '$category',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $group: {
          _id: '$product._id',
          productName: { $first: '$product.name' },
          productCode: { $first: '$product.softwareCode' },
          categoryName: { $first: { $ifNull: ['$category.name', 'Unknown Category'] } },
          totalQuantity: { $sum: '$quantity' },
          totalNSV: { $sum: '$nsv' },
          totalGSV: { $sum: '$gsv' }
        }
      },
      {
        $sort: { totalNSV: -1 }
      },
      {
        $limit: 10
      }
    ]);
    
    // Get store performance in city
    const storePerformance = await Sales.aggregate([
      {
        $match: {
          plant: { $in: storeIds },
          ...dateFilter
        }
      },
      {
        $lookup: {
          from: 'stores',
          localField: 'plant',
          foreignField: '_id',
          as: 'store'
        }
      },
      {
        $unwind: '$store'
      },
      {
        $group: {
          _id: '$store._id',
          storeName: { $first: '$store.storeName' },
          storeId: { $first: '$store.storeId' },
          totalQuantity: { $sum: '$quantity' },
          totalNSV: { $sum: '$nsv' },
          totalGSV: { $sum: '$gsv' }
        }
      },
      {
        $sort: { totalNSV: -1 }
      }
    ]);
    
    const summary = summaryKPIs[0] || {
      totalQuantity: 0,
      totalNSV: 0,
      totalGSV: 0,
      totalDiscount: 0,
      totalTax: 0,
      totalOrders: 0
    };
    
    return {
      totalQuantity: summary.totalQuantity,
      totalNSV: summary.totalNSV,
      totalGSV: summary.totalGSV,
      totalDiscount: summary.totalDiscount,
      totalTax: summary.totalTax,
      totalOrders: summary.totalOrders,
      topProducts,
      storePerformance
    };
    
  } catch (error) {
    console.error('Error in getCitySpecificAnalytics:', error);
    return null;
  }
};

/**
 * Get comprehensive analytics dashboard using analytics service
 * @param {Object} params - Dashboard parameters
 * @returns {Promise<string>} HTML string with analytics dashboard
 */
export const getAnalyticsDashboard = async (params = {}) => {
  try {
    const { dateFrom, dateTo, city } = params;
    
    let filter = {};
    if (dateFrom || dateTo) {
      filter.dateFrom = dateFrom;
      filter.dateTo = dateTo;
    }
    
    // If city is specified, we need to filter data for that city
    if (city) {
      // Find all stores in the specified city
      const storesInCity = await Store.find({ 
        city: { $regex: city, $options: 'i' } 
      }).select('_id storeName storeId city').lean();
      
      if (storesInCity.length === 0) {
        return generateHTMLResponse('No Stores Found', `No stores found in ${city}. Please check the city name.`);
      }
      
      // Get city-specific analytics data
      const cityAnalytics = await getCitySpecificAnalytics(city, filter);
      
      if (!cityAnalytics) {
        return generateHTMLResponse('No Data Available', `No analytics data available for ${city}.`);
      }
      
      // Generate city-specific dashboard HTML
      const html = AI_TOOL_STYLES + `
        <div class="ai-tool-response">
          <h3>📊 Analytics Dashboard - ${city.charAt(0).toUpperCase() + city.slice(1)}</h3>
          
          <!-- City Info -->
          <div class="city-info">
            <p><strong>City:</strong> ${city.charAt(0).toUpperCase() + city.slice(1)}</p>
            <p><strong>Total Stores:</strong> ${storesInCity.length}</p>
            <p><strong>Stores:</strong> ${storesInCity.map(s => s.storeName).join(', ')}</p>
          </div>
          
          <!-- Summary KPIs -->
          <div class="kpi-grid">
            <div class="kpi-item">
              <div class="kpi-label">Total Quantity</div>
              <div class="kpi-value">${cityAnalytics.totalQuantity?.toLocaleString() || '0'}</div>
            </div>
            <div class="kpi-item">
              <div class="kpi-label">Total NSV</div>
              <div class="kpi-value">₹${cityAnalytics.totalNSV?.toLocaleString() || '0'}</div>
            </div>
            <div class="kpi-item">
              <div class="kpi-label">Total GSV</div>
              <div class="kpi-value">₹${cityAnalytics.totalGSV?.toLocaleString() || '0'}</div>
            </div>
            <div class="kpi-item">
              <div class="kpi-label">Total Discount</div>
              <div class="kpi-value">₹${cityAnalytics.totalDiscount?.toLocaleString() || '0'}</div>
            </div>
            <div class="kpi-item">
              <div class="kpi-label">Total Tax</div>
              <div class="kpi-value">₹${cityAnalytics.totalTax?.toLocaleString() || '0'}</div>
            </div>
            <div class="kpi-item">
              <div class="kpi-label">Orders</div>
              <div class="kpi-value">${cityAnalytics.totalOrders?.toLocaleString() || '0'}</div>
            </div>
          </div>
          
          <!-- Top Products in City -->
          ${cityAnalytics.topProducts && cityAnalytics.topProducts.length > 0 ? `
            <div class="chart-container">
              <h4>🏆 Top Products in ${city.charAt(0).toUpperCase() + city.slice(1)}</h4>
              <div class="table-container">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>Rank</th>
                      <th>Product Name</th>
                      <th>Code</th>
                      <th>Category</th>
                      <th>Quantity</th>
                      <th>NSV (₹)</th>
                      <th>GSV (₹)</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${cityAnalytics.topProducts.slice(0, 5).map((product, index) => `
                      <tr>
                        <td>${index + 1}</td>
                        <td>${product.productName || 'Unknown'}</td>
                        <td>${product.productCode || 'N/A'}</td>
                        <td>${product.categoryName || 'Unknown'}</td>
                        <td>${product.totalQuantity.toLocaleString()}</td>
                        <td>₹${product.totalNSV.toLocaleString()}</td>
                        <td>₹${product.totalGSV.toLocaleString()}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          ` : ''}
          
          <!-- Store Performance in City -->
          ${cityAnalytics.storePerformance && cityAnalytics.storePerformance.length > 0 ? `
            <div class="chart-container">
              <h4>🏪 Store Performance in ${city.charAt(0).toUpperCase() + city.slice(1)}</h4>
              <div class="table-container">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>Rank</th>
                      <th>Store Name</th>
                      <th>Store ID</th>
                      <th>Quantity</th>
                      <th>NSV (₹)</th>
                      <th>GSV (₹)</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${cityAnalytics.storePerformance.slice(0, 10).map((store, index) => `
                      <tr>
                        <td>${index + 1}</td>
                        <td>${store.storeName || 'Unknown'}</td>
                        <td>${store.storeId || 'N/A'}</td>
                        <td>${store.totalQuantity.toLocaleString()}</td>
                        <td>₹${store.totalNSV.toLocaleString()}</td>
                        <td>₹${store.totalGSV.toLocaleString()}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          ` : ''}
          
          <p class="summary">Analytics dashboard generated successfully for ${city.charAt(0).toUpperCase() + city.slice(1)} with ${storesInCity.length} stores.</p>
        </div>
      `;
      
      return html;
    }
    
    // Get dashboard data using analytics service
    const dashboardData = await analyticsService.getAnalyticsDashboard(filter);
    
    if (!dashboardData) {
      return generateHTMLResponse('No Data Available', 'Analytics dashboard data not available.');
    }
    
    // Generate comprehensive dashboard HTML
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>📊 Analytics Dashboard</h3>
        
        <!-- Summary KPIs -->
        ${dashboardData.summaryKPIs ? `
          <div class="kpi-grid">
            <div class="kpi-item">
              <div class="kpi-label">Total Quantity</div>
              <div class="kpi-value">${dashboardData.summaryKPIs.totalQuantity?.toLocaleString() || '0'}</div>
            </div>
            <div class="kpi-item">
              <div class="kpi-label">Total NSV</div>
              <div class="kpi-value">₹${dashboardData.summaryKPIs.totalNSV?.toLocaleString() || '0'}</div>
            </div>
            <div class="kpi-item">
              <div class="kpi-label">Total GSV</div>
              <div class="kpi-value">₹${dashboardData.summaryKPIs.totalGSV?.toLocaleString() || '0'}</div>
            </div>
            <div class="kpi-item">
              <div class="kpi-label">Total Discount</div>
              <div class="kpi-value">₹${dashboardData.summaryKPIs.totalDiscount?.toLocaleString() || '0'}</div>
            </div>
            <div class="kpi-item">
              <div class="kpi-label">Total Tax</div>
              <div class="kpi-value">₹${dashboardData.summaryKPIs.totalTax?.toLocaleString() || '0'}</div>
            </div>
            <div class="kpi-item">
              <div class="kpi-label">Orders</div>
              <div class="kpi-value">${dashboardData.summaryKPIs.recordCount?.toLocaleString() || '0'}</div>
            </div>
          </div>
        ` : ''}
        
        <!-- Top Products -->
        ${dashboardData.productPerformance && dashboardData.productPerformance.length > 0 ? `
          <div class="chart-container">
            <h4>🏆 Top Products</h4>
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Product Name</th>
                    <th>Code</th>
                    <th>Category</th>
                    <th>Quantity</th>
                    <th>NSV (₹)</th>
                    <th>GSV (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  ${dashboardData.productPerformance.slice(0, 5).map((product, index) => `
                    <tr>
                      <td>${index + 1}</td>
                      <td>${product.productName || 'Unknown'}</td>
                      <td>${product.productCode || 'N/A'}</td>
                      <td>${product.categoryName || 'Unknown'}</td>
                      <td>${product.totalQuantity.toLocaleString()}</td>
                      <td>₹${product.totalNSV.toLocaleString()}</td>
                      <td>₹${product.totalGSV.toLocaleString()}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}
        
        <!-- Top Stores -->
        ${dashboardData.storePerformance && dashboardData.storePerformance.length > 0 ? `
          <div class="chart-container">
            <h4>🏪 Top Stores</h4>
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Store Name</th>
                    <th>Store ID</th>
                    <th>City</th>
                    <th>Quantity</th>
                    <th>NSV (₹)</th>
                    <th>GSV (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  ${dashboardData.storePerformance.slice(0, 5).map((store, index) => `
                    <tr>
                      <td>${index + 1}</td>
                      <td>${store.storeName || 'Unknown'}</td>
                      <td>${store.storeId || 'N/A'}</td>
                      <td>${store.city || 'Unknown'}</td>
                      <td>${store.totalQuantity.toLocaleString()}</td>
                      <td>₹${store.totalNSV.toLocaleString()}</td>
                      <td>₹${store.totalGSV.toLocaleString()}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}
        
        <!-- Brand Performance -->
        ${dashboardData.brandPerformance && dashboardData.brandPerformance.length > 0 ? `
          <div class="chart-container">
            <h4>🏷️ Brand Performance</h4>
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Brand</th>
                    <th>Quantity</th>
                    <th>NSV (₹)</th>
                    <th>GSV (₹)</th>
                    <th>Orders</th>
                  </tr>
                </thead>
                <tbody>
                  ${dashboardData.brandPerformance.slice(0, 5).map((brand, index) => `
                    <tr>
                      <td>${index + 1}</td>
                      <td>${brand.brandName || 'Unknown'}</td>
                      <td>${brand.totalQuantity.toLocaleString()}</td>
                      <td>₹${brand.totalNSV.toLocaleString()}</td>
                      <td>₹${brand.totalGSV.toLocaleString()}</td>
                      <td>${brand.recordCount}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}
        
        <p class="summary">Analytics dashboard generated successfully with comprehensive business insights.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getAnalyticsDashboard:', error);
    return generateHTMLResponse('Error', `Failed to generate analytics dashboard: ${error.message}`);
  }
};

/**
 * Get brand performance data
 * @param {Object} params - Parameters (dateFrom, dateTo)
 * @returns {Promise<string>} HTML string with brand performance data
 */
export const getBrandPerformance = async (params = {}) => {
  try {
    const { dateFrom, dateTo } = params;
    
    const filter = {};
    if (dateFrom) {
      filter.dateFrom = dateFrom;
    }
    if (dateTo) {
      filter.dateTo = dateTo;
    }
    
    console.log(`[getBrandPerformance] Fetching brand performance with filter:`, filter);
    
    // Get brand performance data from analytics service
    const brandPerformance = await analyticsService.getBrandPerformanceAnalysis(filter);
    
    if (!brandPerformance || brandPerformance.length === 0) {
      return generateHTMLResponse('No Brand Data', 'No brand performance data found. Brands are tracked based on store brand information.');
    }
    
    // Calculate summary statistics
    const totalNSV = brandPerformance.reduce((sum, brand) => sum + (brand.totalNSV || 0), 0);
    const totalGSV = brandPerformance.reduce((sum, brand) => sum + (brand.totalGSV || 0), 0);
    const totalQuantity = brandPerformance.reduce((sum, brand) => sum + (brand.totalQuantity || 0), 0);
    const totalDiscount = brandPerformance.reduce((sum, brand) => sum + (brand.totalDiscount || 0), 0);
    const totalOrders = brandPerformance.reduce((sum, brand) => sum + (brand.recordCount || 0), 0);
    
    const filterInfo = [];
    if (dateFrom && dateTo) {
      filterInfo.push(`Date Range: ${new Date(dateFrom).toLocaleDateString()} to ${new Date(dateTo).toLocaleDateString()}`);
    } else if (dateFrom) {
      filterInfo.push(`From: ${new Date(dateFrom).toLocaleDateString()}`);
    } else if (dateTo) {
      filterInfo.push(`To: ${new Date(dateTo).toLocaleDateString()}`);
    }
    const filterText = filterInfo.length > 0 ? ` (${filterInfo.join(', ')})` : '';
    
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>🏷️ Brand Performance${filterText}</h3>
        
        <div class="kpi-grid">
          <div class="kpi-item">
            <div class="kpi-label">Total Brands</div>
            <div class="kpi-value">${brandPerformance.length}</div>
            <div class="kpi-change">Active Brands</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Total NSV</div>
            <div class="kpi-value">₹${totalNSV.toLocaleString()}</div>
            <div class="kpi-change">Net Sales Value</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Total GSV</div>
            <div class="kpi-value">₹${totalGSV.toLocaleString()}</div>
            <div class="kpi-change">Gross Sales Value</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Total Quantity</div>
            <div class="kpi-value">${totalQuantity.toLocaleString()}</div>
            <div class="kpi-change">Units Sold</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Total Orders</div>
            <div class="kpi-value">${totalOrders.toLocaleString()}</div>
            <div class="kpi-change">Transactions</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Total Discount</div>
            <div class="kpi-value">₹${totalDiscount.toLocaleString()}</div>
            <div class="kpi-change">Discount Applied</div>
          </div>
        </div>
        
        <div class="chart-container">
          <h4>📊 Brand Performance Ranking</h4>
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Brand Name</th>
                  <th>Total Quantity</th>
                  <th>Total NSV (₹)</th>
                  <th>Total GSV (₹)</th>
                  <th>Discount (₹)</th>
                  <th>Orders</th>
                  <th>Market Share</th>
                </tr>
              </thead>
              <tbody>
                ${brandPerformance.map((brand, index) => {
                  const marketShare = totalNSV > 0 ? ((brand.totalNSV / totalNSV) * 100).toFixed(2) : '0.00';
                  return `
                    <tr>
                      <td>${index + 1}</td>
                      <td><strong>${brand.brandName || 'Unknown Brand'}</strong></td>
                      <td>${(brand.totalQuantity || 0).toLocaleString()}</td>
                      <td>₹${(brand.totalNSV || 0).toLocaleString()}</td>
                      <td>₹${(brand.totalGSV || 0).toLocaleString()}</td>
                      <td>₹${(brand.totalDiscount || 0).toLocaleString()}</td>
                      <td>${brand.recordCount || 0}</td>
                      <td>${marketShare}%</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
        
        <p class="summary">
          Found ${brandPerformance.length} brand(s) with sales data. 
          Top brand: <strong>${brandPerformance[0]?.brandName || 'N/A'}</strong> with ₹${(brandPerformance[0]?.totalNSV || 0).toLocaleString()} NSV 
          (${totalNSV > 0 ? ((brandPerformance[0]?.totalNSV / totalNSV) * 100).toFixed(1) : 0}% market share).
        </p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getBrandPerformance:', error);
    return generateHTMLResponse('Error', `Failed to retrieve brand performance data: ${error.message}`);
  }
};

/**
 * Get store performance analysis using analytics service
 * @param {Object} params - Store analysis parameters
 * @returns {Promise<string>} HTML string with store analysis
 */
export const getStoreAnalysis = async (params = {}) => {
  try {
    const { storeId, storeName, city, dateFrom, dateTo } = params;
    
    let filter = {};
    if (dateFrom || dateTo) {
      filter.dateFrom = dateFrom;
      filter.dateTo = dateTo;
    }
    
    let storeData = null;
    
    // Find store by ID, name, or city
    if (storeId) {
      storeData = await analyticsService.getIndividualStoreAnalysis({ ...filter, storeId });
    } else if (storeName || city) {
      const storeFilter = {};
      if (storeName) storeFilter.storeName = { $regex: storeName, $options: 'i' };
      if (city) storeFilter.city = { $regex: city, $options: 'i' };
      
      const stores = await Store.find(storeFilter).limit(1).lean();
      if (stores.length > 0) {
        storeData = await analyticsService.getIndividualStoreAnalysis({ ...filter, storeId: stores[0]._id });
      }
    }
    
    if (!storeData) {
      return generateHTMLResponse('Store Not Found', 'No store found matching the specified criteria.');
    }
    
    // Generate store analysis HTML
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>🏪 Store Performance Analysis</h3>
        
        <!-- Store Info -->
        <div class="city-info">
          <p><strong>Store:</strong> ${storeData.storeInfo.storeName}</p>
          <p><strong>Store ID:</strong> ${storeData.storeInfo.storeId}</p>
          <p><strong>Address:</strong> ${storeData.storeInfo.address}</p>
          <p><strong>Contact:</strong> ${storeData.storeInfo.contactPerson}</p>
          <p><strong>Gross LTV:</strong> ₹${storeData.storeInfo.grossLTV.toLocaleString()}</p>
          <p><strong>Current Month Trend:</strong> ${storeData.storeInfo.currentMonthTrend}%</p>
        </div>
        
        <!-- Monthly Sales Analysis -->
        ${storeData.monthlySalesAnalysis && storeData.monthlySalesAnalysis.length > 0 ? `
          <div class="chart-container">
            <h4>📈 Monthly Sales Analysis</h4>
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>NSV (₹)</th>
                    <th>Quantity</th>
                    <th>Orders</th>
                  </tr>
                </thead>
                <tbody>
                  ${storeData.monthlySalesAnalysis.slice(0, 6).map((month) => `
                    <tr>
                      <td>${new Date(month.month).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</td>
                      <td>₹${month.totalNSV.toLocaleString()}</td>
                      <td>${month.totalQuantity.toLocaleString()}</td>
                      <td>${month.totalOrders}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}
        
        <!-- Top Products in Store -->
        ${storeData.productSalesAnalysis && storeData.productSalesAnalysis.length > 0 ? `
          <div class="chart-container">
            <h4>📦 Top Products in Store</h4>
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Product Name</th>
                    <th>Code</th>
                    <th>NSV (₹)</th>
                    <th>Quantity</th>
                    <th>Orders</th>
                  </tr>
                </thead>
                <tbody>
                  ${storeData.productSalesAnalysis.slice(0, 5).map((product, index) => `
                    <tr>
                      <td>${index + 1}</td>
                      <td>${product.productName || 'Unknown'}</td>
                      <td>${product.productCode || 'N/A'}</td>
                      <td>₹${product.totalNSV.toLocaleString()}</td>
                      <td>${product.totalQuantity.toLocaleString()}</td>
                      <td>${product.totalOrders}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}
        
        <p class="summary">Store analysis completed for ${storeData.storeInfo.storeName}.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getStoreAnalysis:', error);
    return generateHTMLResponse('Error', `Failed to generate store analysis: ${error.message}`);
  }
};

/**
 * Generate HTML response wrapper
 * @param {string} title - Response title
 * @param {string} content - Response content
 * @returns {string} Formatted HTML
 */
const generateHTMLResponse = (title, content) => {
  return AI_TOOL_STYLES + `
    <div class="ai-tool-response">
      <h3>${title}</h3>
      <div class="response-content">
        <p>${content}</p>
      </div>
    </div>
  `;
};

/**
 * Get sales forecast for specific product and city
 * @param {Object} params - Forecast parameters
 * @returns {Promise<string>} HTML string with forecast data
 */
export const getProductForecast = async (params = {}) => {
  try {
    const { productName, city } = params;
    
    if (!productName) {
      return generateHTMLResponse('Product Required', 'Please specify a product name for forecasting.');
    }
    
    // Find product by name
    const product = await Product.findOne({ 
      name: { $regex: productName, $options: 'i' } 
    }).lean();
    
    if (!product) {
      return generateHTMLResponse('Product Not Found', `Product "${productName}" not found in the system.`);
    }
    
    let storeFilter = {};
    if (city) {
      storeFilter.city = { $regex: city, $options: 'i' };
    }
    
    // Get stores
    const stores = await Store.find(storeFilter).select('_id storeName city').lean();
    if (stores.length === 0) {
      return generateHTMLResponse('No Stores Found', city ? `No stores found in ${city}.` : 'No stores found in the system.');
    }
    
    // Get forecast data using analytics service
    const forecastData = await analyticsService.getProductDemandForecasting({
      productId: product._id,
      months: 3
    });
    
    // Filter forecast data for specific stores if city is specified
    let filteredForecast = forecastData.forecastData;
    if (city) {
      const storeIds = stores.map(s => s._id.toString());
      filteredForecast = forecastData.forecastData.filter(f => 
        storeIds.includes(f.storeId.toString())
      );
    }
    
    if (filteredForecast.length === 0) {
      return generateHTMLResponse('No Forecast Data', `No forecast data available for ${productName}${city ? ` in ${city}` : ''}.`);
    }
    
    // Generate forecast HTML
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>🔮 Sales Forecast for ${product.name}</h3>
        <div class="city-info">
          <p><strong>Product:</strong> ${product.name}</p>
          <p><strong>Product Code:</strong> ${product.softwareCode || 'N/A'}</p>
          ${city ? `<p><strong>City:</strong> ${city}</p>` : ''}
          <p><strong>Forecast Period:</strong> Next 3 months</p>
        </div>
        
        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th>Month</th>
                <th>Store</th>
                <th>City</th>
                <th>Forecasted Quantity</th>
                <th>Forecasted NSV (₹)</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              ${filteredForecast.map((forecast) => `
                <tr>
                  <td>${new Date(forecast.forecastMonth).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</td>
                  <td>${forecast.storeName || 'Unknown'}</td>
                  <td>${forecast.storeCode || 'N/A'}</td>
                  <td>${forecast.forecastedQuantity.toLocaleString()}</td>
                  <td>₹${forecast.forecastedNSV.toLocaleString()}</td>
                  <td>${(forecast.confidence * 100).toFixed(1)}%</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        
        <p class="summary">Forecast generated for ${product.name}${city ? ` in ${city}` : ''} across ${stores.length} stores.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getProductForecast:', error);
    return generateHTMLResponse('Error', `Failed to generate forecast: ${error.message}`);
  }
};

/**
 * Get system capabilities and use cases
 * @returns {Promise<string>} HTML string with capabilities
 */
/**
 * Get available commands list
 * @returns {Promise<string>} HTML string with commands list
 */
export const getCommands = async () => {
  const html = AI_TOOL_STYLES + `
    <div class="ai-tool-response">
      <h3>📋 Available Commands</h3>
      
      <div class="chart-container">
        <h4>🔍 Search & Query Commands</h4>
        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th>Command</th>
                <th>Description</th>
                <th>Example</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>/commands</code> or <code>/help</code></td>
                <td>Show this commands list</td>
                <td><code>/commands</code></td>
              </tr>
              <tr>
                <td><code>yarn issue</code></td>
                <td>Get yarn issue records</td>
                <td><code>yarn issue</code> or <code>yarn issue ORD-000001</code></td>
              </tr>
              <tr>
                <td><code>yarn issue [order]</code></td>
                <td>Search yarn issues by order number</td>
                <td><code>yarn issue ORD-000001</code> or <code>yarn issue by order ORD-000001</code></td>
              </tr>
              <tr>
                <td><code>yarn catalog</code></td>
                <td>Get yarn catalog</td>
                <td><code>show yarn catalog</code></td>
              </tr>
              <tr>
                <td><code>yarn inventory</code></td>
                <td>Get yarn inventory</td>
                <td><code>yarn inventory</code></td>
              </tr>
              <tr>
                <td><code>yarn transactions</code></td>
                <td>Get yarn transactions</td>
                <td><code>yarn transactions</code></td>
              </tr>
              <tr>
                <td><code>yarn requisitions</code></td>
                <td>Get yarn requisitions</td>
                <td><code>yarn requisitions</code></td>
              </tr>
              <tr>
                <td><code>yarn purchase orders</code></td>
                <td>Get yarn purchase orders</td>
                <td><code>yarn purchase orders</code></td>
              </tr>
              <tr>
                <td><code>yarn types</code></td>
                <td>Get yarn types</td>
                <td><code>yarn types</code></td>
              </tr>
              <tr>
                <td><code>yarn suppliers</code></td>
                <td>Get yarn suppliers/brands</td>
                <td><code>yarn suppliers</code></td>
              </tr>
              <tr>
                <td><code>yarn colors</code></td>
                <td>Get yarn colors</td>
                <td><code>yarn colors</code></td>
              </tr>
              <tr>
                <td><code>yarn blends</code></td>
                <td>Get yarn blends</td>
                <td><code>yarn blends</code></td>
              </tr>
              <tr>
                <td><code>yarn count sizes</code></td>
                <td>Get yarn count sizes</td>
                <td><code>yarn count sizes</code></td>
              </tr>
              <tr>
                <td><code>yarn boxes</code></td>
                <td>Get yarn boxes</td>
                <td><code>yarn boxes</code></td>
              </tr>
              <tr>
                <td><code>yarn cones</code></td>
                <td>Get yarn cones</td>
                <td><code>yarn cones</code></td>
              </tr>
              <tr>
                <td><code>raw materials</code></td>
                <td>Get raw materials</td>
                <td><code>show raw materials</code></td>
              </tr>
              <tr>
                <td><code>processes</code></td>
                <td>Get processes</td>
                <td><code>show processes</code></td>
              </tr>
              <tr>
                <td><code>attributes</code></td>
                <td>Get product attributes</td>
                <td><code>show attributes</code></td>
              </tr>
              <tr>
                <td><code>categories</code></td>
                <td>Get categories</td>
                <td><code>show categories</code></td>
              </tr>
              <tr>
                <td><code>storage slots</code></td>
                <td>Get storage slots</td>
                <td><code>storage slots</code> or <code>storage slots page 2</code></td>
              </tr>
              <tr>
                <td><code>items</code> or <code>products list</code></td>
                <td>Get master catalog items</td>
                <td><code>items</code> or <code>products list page 2</code></td>
              </tr>
              <tr>
                <td><code>stores</code></td>
                <td>Get stores list</td>
                <td><code>stores</code> or <code>stores page 2</code></td>
              </tr>
              <tr>
                <td><code>stores in [city]</code></td>
                <td>Get stores filtered by city</td>
                <td><code>stores in Mumbai</code> or <code>stores in Delhi</code></td>
              </tr>
              <tr>
                <td><code>active stores</code> or <code>inactive stores</code></td>
                <td>Get stores filtered by status</td>
                <td><code>active stores</code> or <code>stores in Mumbai active</code></td>
              </tr>
              <tr>
                <td><code>machine statistics</code></td>
                <td>Get machine statistics</td>
                <td><code>machine statistics</code></td>
              </tr>
              <tr>
                <td><code>machines on [floor]</code></td>
                <td>Get machines by floor</td>
                <td><code>machines on Floor 1</code></td>
              </tr>
              <tr>
                <td><code>active machines</code></td>
                <td>Get machines by status</td>
                <td><code>active machines</code></td>
              </tr>
              <tr>
                <td><code>production orders</code></td>
                <td>Get production orders</td>
                <td><code>production orders</code></td>
              </tr>
              <tr>
                <td><code>production dashboard</code></td>
                <td>Get production dashboard</td>
                <td><code>production dashboard</code></td>
              </tr>
              <tr>
                <td><code>analytics dashboard</code></td>
                <td>Get analytics dashboard</td>
                <td><code>analytics dashboard</code> or <code>analytics for mumbai</code></td>
              </tr>
              <tr>
                <td><code>sales report</code></td>
                <td>Get sales report</td>
                <td><code>sales report</code></td>
              </tr>
              <tr>
                <td><code>sales data</code></td>
                <td>Get sales data/transactions</td>
                <td><code>sales data</code> or <code>sales data in Mumbai</code></td>
              </tr>
              <tr>
                <td><code>top products</code></td>
                <td>Get top products</td>
                <td><code>top products</code> or <code>top 5 products in delhi</code></td>
              </tr>
              <tr>
                <td><code>product count</code></td>
                <td>Get total product count</td>
                <td><code>how many products do we have</code></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      
      <div class="chart-container">
        <h4>💡 Tips</h4>
        <div class="response-content">
          <p><strong>• Pagination:</strong> For large datasets, use "page 2", "page 3", etc. (e.g., "storage slots page 2")</p>
          <p><strong>• Search:</strong> You can search yarn issues by order number (e.g., "yarn issue ORD-000001") or order ID</p>
          <p><strong>• Natural Language:</strong> Ask questions naturally - the AI understands various phrasings</p>
          <p><strong>• Commands:</strong> Type <code>/</code> to see available commands</p>
        </div>
      </div>
      
      <p class="summary">Type <code>/commands</code> or <code>/help</code> anytime to see this list again!</p>
    </div>
  `;
  
  return {
    type: 'ai_tool',
    intent: {
      action: 'getCommands',
      description: 'Show available commands'
    },
    response: html
  };
};

export const getCapabilities = async () => {
  const html = AI_TOOL_STYLES + `
    <div class="ai-tool-response">
      <h3>🚀 System Capabilities & Use Cases</h3>
      
      <div class="kpi-grid">
        <div class="kpi-item">
          <div class="kpi-label">📊 Analytics & Reporting</div>
          <div class="kpi-value">Complete</div>
          <div class="kpi-change">Sales trends, product performance, store analysis</div>
        </div>
        <div class="kpi-item">
          <div class="kpi-label">🔮 Demand Forecasting</div>
          <div class="kpi-value">Advanced</div>
          <div class="kpi-change">Product & store-level predictions</div>
        </div>
        <div class="kpi-item">
          <div class="kpi-label">📦 Inventory Management</div>
          <div class="kpi-value">Smart</div>
          <div class="kpi-change">Replenishment recommendations</div>
        </div>
        <div class="kpi-item">
          <div class="kpi-label">🏪 Store Performance</div>
          <div class="kpi-value">Real-time</div>
          <div class="kpi-change">Individual store analytics</div>
        </div>
        <div class="kpi-item">
          <div class="kpi-label">🏭 Machine Management</div>
          <div class="kpi-value">Complete</div>
          <div class="kpi-change">Machine statistics, status, floor-wise tracking</div>
        </div>
        <div class="kpi-item">
          <div class="kpi-label">🧵 Yarn Management</div>
          <div class="kpi-value">Complete</div>
          <div class="kpi-change">Catalog, inventory, transactions, requisitions, types, suppliers, colors, blends, count sizes, boxes, cones</div>
        </div>
        <div class="kpi-item">
          <div class="kpi-label">📦 Raw Materials</div>
          <div class="kpi-value">Complete</div>
          <div class="kpi-change">Raw material catalog and management</div>
        </div>
        <div class="kpi-item">
          <div class="kpi-label">⚙️ Processes</div>
          <div class="kpi-value">Complete</div>
          <div class="kpi-change">Process management and tracking</div>
        </div>
        <div class="kpi-item">
          <div class="kpi-label">📋 Attributes</div>
          <div class="kpi-value">Complete</div>
          <div class="kpi-change">Product attributes management</div>
        </div>
        <div class="kpi-item">
          <div class="kpi-label">🏭 Production</div>
          <div class="kpi-value">Available</div>
          <div class="kpi-change">Production orders and dashboard</div>
        </div>
        <div class="kpi-item">
          <div class="kpi-label">📋 Orders</div>
          <div class="kpi-value">Available</div>
          <div class="kpi-change">Order tracking and management</div>
        </div>
      </div>
      
      <div class="chart-container">
        <h4>🎯 Key Use Cases</h4>
        <div class="response-content">
          <p><strong>1. Sales Analysis:</strong> Track product performance, identify top sellers, analyze trends</p>
          <p><strong>2. Store Optimization:</strong> Compare store performance, identify improvement opportunities</p>
          <p><strong>3. Demand Planning:</strong> Forecast future sales, optimize inventory levels</p>
          <p><strong>4. Product Insights:</strong> Analyze individual product performance across stores</p>
          <p><strong>5. Geographic Analysis:</strong> City-wise performance, regional trends</p>
          <p><strong>6. Inventory Optimization:</strong> Prevent stockouts, reduce excess inventory</p>
          <p><strong>7. Machine Management:</strong> Track machine status, maintenance, floor-wise distribution</p>
          <p><strong>8. Yarn Operations:</strong> Monitor yarn inventory, transactions, requisitions, purchase orders, boxes, cones</p>
          <p><strong>9. Categories:</strong> Manage product categories and classifications</p>
          <p><strong>10. Storage Management:</strong> Track storage slots and locations</p>
          <p><strong>11. Production Tracking:</strong> Monitor production orders and dashboard metrics</p>
        </div>
      </div>
      
      <div class="chart-container">
        <h4>💡 How to Use</h4>
        <div class="response-content">
          <p><strong>• Sales & Analytics:</strong> "Show me top products", "Generate sales report", "Analytics for Mumbai"</p>
          <p><strong>• Product Analysis:</strong> "Give me PE Mens Full Rib analysis", "Product count"</p>
          <p><strong>• Store Performance:</strong> "Show me store ABC data", "Store performance analysis"</p>
          <p><strong>• Forecasting:</strong> "Next month sales forecast for Product X in Mumbai"</p>
          <p><strong>• Machines:</strong> "Show me machine statistics", "Machines on Floor 1", "Active machines"</p>
          <p><strong>• Yarn:</strong> "Show me yarn catalog", "Yarn inventory", "Yarn transactions", "Yarn purchase orders", "Yarn types", "Yarn suppliers", "Yarn colors", "Yarn blends", "Yarn count sizes", "Yarn boxes", "Yarn cones"</p>
          <p><strong>• Categories:</strong> "Show me categories", "List categories"</p>
          <p><strong>• Storage:</strong> "Show me storage slots", "Storage"</p>
          <p><strong>• Raw Materials:</strong> "Show me raw materials", "List raw materials"</p>
          <p><strong>• Processes:</strong> "Show me processes", "List processes"</p>
          <p><strong>• Attributes:</strong> "Show me product attributes", "List attributes"</p>
          <p><strong>• Production:</strong> "Production orders", "Production dashboard"</p>
        </div>
      </div>
      
      <p class="summary">Our AI-powered system provides comprehensive business intelligence for retail operations, manufacturing, and supply chain management.</p>
    </div>
  `;
  
  return html;
};

/**
 * Get detailed product analysis by product name
 * @param {Object} params - Product analysis parameters
 * @returns {Promise<string>} HTML string with product analysis
 */
export const getProductAnalysis = async (params = {}) => {
  try {
    const { productName } = params;
    
    if (!productName) {
      return generateHTMLResponse('Product Required', 'Please specify a product name for analysis.');
    }
    
    // Find product by name
    const product = await Product.findOne({ 
      name: { $regex: productName, $options: 'i' } 
    }).lean();
    
    if (!product) {
      return generateHTMLResponse('Product Not Found', `Product "${productName}" not found in the system.`);
    }
    
    // Get product analysis directly from sales data
    const productAnalysis = await Sales.aggregate([
      { $match: { materialCode: product._id } },
      {
        $lookup: {
          from: 'stores',
          localField: 'plant',
          foreignField: '_id',
          as: 'storeData'
        }
      },
      { $unwind: '$storeData' },
      {
        $lookup: {
          from: 'categories',
          localField: 'product.category',
          foreignField: '_id',
          as: 'categoryData'
        }
      },
      {
        $unwind: {
          path: '$categoryData',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $group: {
          _id: null,
          totalQuantity: { $sum: '$quantity' },
          totalNSV: { $sum: '$nsv' },
          totalGSV: { $sum: '$gsv' },
          totalDiscount: { $sum: '$discount' },
          totalOrders: { $sum: 1 },
          avgOrderValue: { $avg: '$nsv' }
        }
      }
    ]);
    
    if (!productAnalysis || productAnalysis.length === 0) {
      return generateHTMLResponse('No Sales Data', `No sales data available for ${product.name}.`);
    }
    
    const summary = productAnalysis[0];
    
    // Get monthly sales analysis
    const monthlySales = await Sales.aggregate([
      { $match: { materialCode: product._id } },
      {
        $group: {
          _id: {
            year: { $year: '$date' },
            month: { $month: '$date' }
          },
          totalQuantity: { $sum: '$quantity' },
          totalNSV: { $sum: '$nsv' },
          totalOrders: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
      { $limit: 6 }
    ]);
    
    // Get store-wise performance
    const storePerformance = await Sales.aggregate([
      { $match: { materialCode: product._id } },
      {
        $lookup: {
          from: 'stores',
          localField: 'plant',
          foreignField: '_id',
          as: 'storeData'
        }
      },
      { $unwind: '$storeData' },
      {
        $group: {
          _id: '$storeData._id',
          storeName: { $first: '$storeData.storeName' },
          storeCode: { $first: '$storeData.storeId' },
          totalQuantity: { $sum: '$quantity' },
          totalNSV: { $sum: '$nsv' },
          totalOrders: { $sum: 1 }
        }
      },
      { $sort: { totalNSV: -1 } },
      { $limit: 10 }
    ]);
    
    // Calculate trend (simple comparison with previous period)
    let currentTrend = 0;
    if (monthlySales.length >= 2) {
      const currentMonth = monthlySales[monthlySales.length - 1];
      const previousMonth = monthlySales[monthlySales.length - 2];
      if (previousMonth.totalNSV > 0) {
        currentTrend = ((currentMonth.totalNSV - previousMonth.totalNSV) / previousMonth.totalNSV * 100).toFixed(1);
      }
    }
    
    // Generate product analysis HTML
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>📦 Product Analysis: ${product.name}</h3>
        
        <!-- Product Info -->
        <div class="city-info">
          <p><strong>Product Name:</strong> ${product.name}</p>
          <p><strong>Product Code:</strong> ${product.softwareCode || 'N/A'}</p>
          <p><strong>Category:</strong> ${product.category ? 'Unknown Category' : 'Uncategorized'}</p>
          <p><strong>Total Quantity Sold:</strong> ${(summary.totalQuantity || 0).toLocaleString()}</p>
          <p><strong>Total Revenue (NSV):</strong> ₹${(summary.totalNSV || 0).toLocaleString()}</p>
          <p><strong>Total Revenue (GSV):</strong> ₹${(summary.totalGSV || 0).toLocaleString()}</p>
          <p><strong>Total Discount:</strong> ₹${(summary.totalDiscount || 0).toLocaleString()}</p>
          <p><strong>Total Orders:</strong> ${(summary.totalOrders || 0).toLocaleString()}</p>
          <p><strong>Average Order Value:</strong> ₹${(summary.avgOrderValue || 0).toFixed(2)}</p>
          <p><strong>Current Trend:</strong> ${currentTrend}%</p>
        </div>
        
        <!-- Monthly Sales Analysis -->
        ${monthlySales && monthlySales.length > 0 ? `
          <div class="chart-container">
            <h4>📈 Monthly Sales Trend</h4>
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Quantity Sold</th>
                    <th>Revenue (₹)</th>
                    <th>Orders</th>
                  </tr>
                </thead>
                <tbody>
                  ${monthlySales.map((month) => `
                    <tr>
                      <td>${month._id.month}/${month._id.year}</td>
                      <td>${(month.totalQuantity || 0).toLocaleString()}</td>
                      <td>₹${(month.totalNSV || 0).toLocaleString()}</td>
                      <td>${month.totalOrders || 0}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}
        
        <!-- Store-wise Performance -->
        ${storePerformance && storePerformance.length > 0 ? `
          <div class="chart-container">
            <h4>🏪 Store Performance</h4>
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Store Name</th>
                    <th>Store Code</th>
                    <th>Quantity Sold</th>
                    <th>Revenue (₹)</th>
                    <th>Orders</th>
                  </tr>
                </thead>
                <tbody>
                  ${storePerformance.map((store, index) => `
                    <tr>
                      <td>${index + 1}</td>
                      <td>${store.storeName || 'Unknown'}</td>
                      <td>${store.storeCode || 'N/A'}</td>
                      <td>${(store.totalQuantity || 0).toLocaleString()}</td>
                      <td>₹${(store.totalNSV || 0).toLocaleString()}</td>
                      <td>${store.totalOrders || 0}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}
        
        <p class="summary">Product analysis completed for ${product.name} with comprehensive performance insights.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getProductAnalysis:', error);
    return generateHTMLResponse('Error', `Failed to generate product analysis: ${error.message}`);
  }
};

/**
 * Get store analysis by store name
 * @param {Object} params - Store analysis parameters
 * @returns {Promise<string>} HTML string with store analysis
 */
export const getStoreAnalysisByName = async (params = {}) => {
  try {
    const { storeName } = params;
    
    if (!storeName) {
      return generateHTMLResponse('Store Required', 'Please specify a store name for analysis.');
    }
    
    // Find store by name
    const store = await Store.findOne({ 
      storeName: { $regex: storeName, $options: 'i' } 
    }).lean();
    
    if (!store) {
      return generateHTMLResponse('Store Not Found', `Store "${storeName}" not found in the system.`);
    }
    
    // Get store analysis using analytics service
    const storeAnalysis = await analyticsService.getIndividualStoreAnalysis({
      storeId: store._id
    });
    
    if (!storeAnalysis) {
      return generateHTMLResponse('No Data Available', `No analysis data available for ${store.storeName}.`);
    }
    
    // Generate store analysis HTML
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>🏪 Store Analysis: ${store.storeName}</h3>
        
        <!-- Store Info -->
        <div class="city-info">
          <p><strong>Store Name:</strong> ${store.storeName}</p>
          <p><strong>Store ID:</strong> ${store.storeId}</p>
          <p><strong>City:</strong> ${store.city}</p>
          <p><strong>Address:</strong> ${store.addressLine1}, ${store.city}, ${store.state}</p>
          <p><strong>Contact:</strong> ${store.contactPerson} (${store.contactPerson})</p>
          <p><strong>Gross LTV:</strong> ₹${storeAnalysis.storeInfo.grossLTV.toLocaleString()}</p>
          <p><strong>Current Month Trend:</strong> ${storeAnalysis.storeInfo.currentMonthTrend}%</p>
        </div>
        
        <!-- Monthly Sales Analysis -->
        ${storeAnalysis.monthlySalesAnalysis && storeAnalysis.monthlySalesAnalysis.length > 0 ? `
          <div class="chart-container">
            <h4>📈 Monthly Sales Trend</h4>
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Quantity Sold</th>
                    <th>Revenue (₹)</th>
                    <th>Orders</th>
                  </tr>
                </thead>
                <tbody>
                  ${storeAnalysis.monthlySalesAnalysis.slice(0, 6).map((month) => `
                    <tr>
                      <td>${new Date(month.month).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</td>
                      <td>${month.totalQuantity.toLocaleString()}</td>
                      <td>₹${month.totalNSV.toLocaleString()}</td>
                      <td>${month.totalOrders}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}
        
        <!-- Top Products in Store -->
        ${storeAnalysis.productSalesAnalysis && storeAnalysis.productSalesAnalysis.length > 0 ? `
          <div class="chart-container">
            <h4>📦 Top Products</h4>
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Product Name</th>
                    <th>Product Code</th>
                    <th>Quantity Sold</th>
                    <th>Revenue (₹)</th>
                    <th>Orders</th>
                  </tr>
                </thead>
                <tbody>
                  ${storeAnalysis.productSalesAnalysis.slice(0, 10).map((product, index) => `
                    <tr>
                      <td>${index + 1}</td>
                      <td>${product.productName || 'Unknown'}</td>
                      <td>${product.productCode || 'N/A'}</td>
                      <td>${product.totalQuantity.toLocaleString()}</td>
                      <td>₹${product.totalNSV.toLocaleString()}</td>
                      <td>${product.totalOrders}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}
        
        <p class="summary">Store analysis completed for ${store.storeName} with comprehensive performance insights.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getStoreAnalysisByName:', error);
    return generateHTMLResponse('Error', `Failed to generate store analysis: ${error.message}`);
  }
};

/**
 * Get machine statistics
 * @returns {Promise<string>} HTML string with machine statistics
 */
export const getMachineStatistics = async () => {
  try {
    const machines = await machineService.queryMachines({}, { limit: 1000 });
    
    const totalMachines = machines.totalResults || 0;
    const activeMachines = machines.results?.filter(m => m.status === 'Active').length || 0;
    const maintenanceMachines = machines.results?.filter(m => m.status === 'Under Maintenance').length || 0;
    const idleMachines = machines.results?.filter(m => m.status === 'Idle').length || 0;
    
    // Count machines by floor
    const floorCounts = {};
    machines.results?.forEach(machine => {
      const floor = machine.floor || 'Unknown';
      floorCounts[floor] = (floorCounts[floor] || 0) + 1;
    });
    
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>🏭 Machine Statistics</h3>
        <div class="kpi-grid">
          <div class="kpi-item">
            <div class="kpi-label">Total Machines</div>
            <div class="kpi-value">${totalMachines}</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Active</div>
            <div class="kpi-value">${activeMachines}</div>
            <div class="kpi-change positive">${totalMachines > 0 ? ((activeMachines / totalMachines) * 100).toFixed(1) : 0}%</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Under Maintenance</div>
            <div class="kpi-value">${maintenanceMachines}</div>
            <div class="kpi-change negative">${totalMachines > 0 ? ((maintenanceMachines / totalMachines) * 100).toFixed(1) : 0}%</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Idle</div>
            <div class="kpi-value">${idleMachines}</div>
            <div class="kpi-change">${totalMachines > 0 ? ((idleMachines / totalMachines) * 100).toFixed(1) : 0}%</div>
          </div>
        </div>
        ${Object.keys(floorCounts).length > 0 ? `
          <div class="chart-container">
            <h4>📊 Machines by Floor</h4>
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Floor</th>
                    <th>Machine Count</th>
                  </tr>
                </thead>
                <tbody>
                  ${Object.entries(floorCounts).map(([floor, count]) => `
                    <tr>
                      <td>${floor}</td>
                      <td>${count}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}
        <p class="summary">Total of ${totalMachines} machines in the system.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getMachineStatistics:', error);
    return generateHTMLResponse('Error', `Failed to retrieve machine statistics: ${error.message}`);
  }
};

/**
 * Get machines by status
 * @param {Object} params - Parameters with machineStatus
 * @returns {Promise<string>} HTML string with machines
 */
export const getMachinesByStatus = async (params = {}) => {
  try {
    const { machineStatus } = params;
    
    if (!machineStatus) {
      return generateHTMLResponse('Status Required', 'Please specify machine status (Active, Under Maintenance, or Idle).');
    }
    
    const machines = await machineService.queryMachines({ status: machineStatus }, { limit: 100 });
    
    if (!machines.results || machines.results.length === 0) {
      // More natural message based on status
      const statusLower = machineStatus.toLowerCase();
      let message = '';
      if (statusLower === 'idle' || statusLower === 'inactive') {
        message = 'No inactive machines found.';
      } else if (statusLower === 'active') {
        message = 'No active machines found.';
      } else if (statusLower === 'under maintenance') {
        message = 'No machines are currently under maintenance.';
      } else {
        message = `No machines found with status: ${machineStatus}`;
      }
      return generateHTMLResponse('No Machines Found', message);
    }
    
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>🏭 Machines - ${machineStatus}</h3>
        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th>Machine Code</th>
                <th>Machine Number</th>
                <th>Model</th>
                <th>Floor</th>
                <th>Needle Size</th>
                <th>Status</th>
                <th>Capacity/Day</th>
              </tr>
            </thead>
            <tbody>
              ${machines.results.map((machine) => `
                <tr>
                  <td>${machine.machineCode || 'N/A'}</td>
                  <td>${machine.machineNumber || 'N/A'}</td>
                  <td>${machine.model || 'N/A'}</td>
                  <td>${machine.floor || 'N/A'}</td>
                  <td>${machine.needleSize || 'N/A'}</td>
                  <td>${machine.status || 'N/A'}</td>
                  <td>${machine.capacityPerDay || 0}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <p class="summary">Found ${machines.results.length} machines with status: ${machineStatus}</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getMachinesByStatus:', error);
    return generateHTMLResponse('Error', `Failed to retrieve machines: ${error.message}`);
  }
};

/**
 * Get machines by floor
 * @param {Object} params - Parameters with floor
 * @returns {Promise<string>} HTML string with machines
 */
export const getMachinesByFloor = async (params = {}) => {
  try {
    const { floor } = params;
    
    if (!floor) {
      return generateHTMLResponse('Floor Required', 'Please specify a floor name.');
    }
    
    const machines = await machineService.queryMachines({ floor: { $regex: floor, $options: 'i' } }, { limit: 100 });
    
    if (!machines.results || machines.results.length === 0) {
      return generateHTMLResponse('No Machines Found', `No machines found on floor: ${floor}`);
    }
    
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>🏭 Machines on ${floor}</h3>
        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th>Machine Code</th>
                <th>Machine Number</th>
                <th>Model</th>
                <th>Status</th>
                <th>Needle Size</th>
                <th>Capacity/Day</th>
              </tr>
            </thead>
            <tbody>
              ${machines.results.map((machine) => `
                <tr>
                  <td>${machine.machineCode || 'N/A'}</td>
                  <td>${machine.machineNumber || 'N/A'}</td>
                  <td>${machine.model || 'N/A'}</td>
                  <td>${machine.status || 'N/A'}</td>
                  <td>${machine.needleSize || 'N/A'}</td>
                  <td>${machine.capacityPerDay || 0}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <p class="summary">Found ${machines.results.length} machines on ${floor}</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getMachinesByFloor:', error);
    return generateHTMLResponse('Error', `Failed to retrieve machines: ${error.message}`);
  }
};

/**
 * Get yarn catalog
 * @param {Object} params - Parameters with optional yarnType filter, page, and limit
 * @returns {Promise<string>} HTML string with yarn catalog
 */
export const getYarnCatalog = async (params = {}) => {
  try {
    const safeParams = params && typeof params === 'object' ? params : {};
    const { 
      yarnType, 
      yarnName, 
      yarnId, 
      countSize, 
      blend, 
      colorFamily, 
      pantonShade, 
      pantonName, 
      season, 
      hsnCode, 
      status,
      limit = 20, 
      page = 1 
    } = safeParams;
    const currentPage = parseInt(page) || 1;
    const pageLimit = parseInt(limit) || 20;
    
    console.log(`[getYarnCatalog] Called with params:`, { page, currentPage, limit: pageLimit, yarnName, status });
    console.log(`[getYarnCatalog] Raw page param:`, page, `Parsed currentPage:`, currentPage);
    
    // Build filter object - support ALL fields
    let filter = {};
    if (yarnType) {
      filter['yarnType.name'] = { $regex: yarnType, $options: 'i' };
    }
    if (yarnName) {
      filter.yarnName = { $regex: yarnName, $options: 'i' };
    }
    if (yarnId) {
      filter._id = yarnId; // Direct ID match
    }
    if (countSize) {
      filter['countSize.name'] = { $regex: countSize, $options: 'i' };
    }
    if (blend) {
      filter['blend.name'] = { $regex: blend, $options: 'i' };
    }
    if (colorFamily) {
      filter['colorFamily.name'] = { $regex: colorFamily, $options: 'i' };
    }
    if (pantonShade) {
      filter.pantonShade = { $regex: pantonShade, $options: 'i' };
    }
    if (pantonName) {
      filter.pantonName = { $regex: pantonName, $options: 'i' };
    }
    if (season) {
      filter.season = { $regex: season, $options: 'i' };
    }
    if (hsnCode) {
      filter.hsnCode = { $regex: hsnCode, $options: 'i' };
    }
    if (status) {
      filter.status = status.toLowerCase();
    }
    
    const yarnCatalogs = await yarnCatalogService.queryYarnCatalogs(filter, { 
      limit: pageLimit,
      page: currentPage
    });
    
    if (!yarnCatalogs.results || yarnCatalogs.results.length === 0) {
      const filterSummary = Object.keys(filter).length > 0 
        ? ` matching filters: ${Object.keys(filter).join(', ')}` 
        : '';
      return generateHTMLResponse('No Yarn Found', `No yarn catalog entries found${filterSummary}.`);
    }
    
    const totalCount = yarnCatalogs.totalResults || yarnCatalogs.results.length;
    const totalPages = yarnCatalogs.totalPages || Math.ceil(totalCount / pageLimit);
    const paginationHTML = generatePaginationHTML(currentPage, totalPages, totalCount, 'yarn catalog');
    
    // Build filter summary
    const appliedFilters = [];
    if (yarnType) appliedFilters.push(`Type: ${yarnType}`);
    if (yarnName) appliedFilters.push(`Name: ${yarnName}`);
    if (countSize) appliedFilters.push(`Count Size: ${countSize}`);
    if (blend) appliedFilters.push(`Blend: ${blend}`);
    if (colorFamily) appliedFilters.push(`Color Family: ${colorFamily}`);
    if (pantonShade) appliedFilters.push(`Pantone Shade: ${pantonShade}`);
    if (pantonName) appliedFilters.push(`Pantone Name: ${pantonName}`);
    if (season) appliedFilters.push(`Season: ${season}`);
    if (hsnCode) appliedFilters.push(`HSN Code: ${hsnCode}`);
    if (status) appliedFilters.push(`Status: ${status}`);
    const filterSummary = appliedFilters.length > 0 
      ? `<p style="margin: 10px 0; padding: 10px; background: #e3f2fd; border-radius: 4px; color: #1976d2;"><strong>Filters Applied:</strong> ${appliedFilters.join(', ')}</p>` 
      : '';
    
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>🧵 Yarn Catalog</h3>
        ${filterSummary}
        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th>Yarn Name</th>
                <th>Type</th>
                <th>Subtype</th>
                <th>Count Size</th>
                <th>Blend</th>
                <th>Color Family</th>
                <th>Pantone Name</th>
                <th>GST</th>
                <th>Min Quantity</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${yarnCatalogs.results.map((yarn) => `
                <tr>
                  <td><strong>${yarn.yarnName || 'N/A'}</strong></td>
                  <td>${yarn.yarnType?.name || 'N/A'}</td>
                  <td>${yarn.yarnSubtype?.subtype || 'N/A'}</td>
                  <td>${yarn.countSize?.name || 'N/A'}</td>
                  <td>${yarn.blend?.name || yarn.blend?.blendName || 'N/A'}</td>
                  <td>${yarn.colorFamily?.name || 'N/A'}</td>
                  <td>${yarn.pantonName || 'N/A'}</td>
                  <td>${yarn.gst !== undefined && yarn.gst !== null ? `${yarn.gst}%` : 'N/A'}</td>
                  <td>${yarn.minQuantity !== undefined && yarn.minQuantity !== null ? yarn.minQuantity.toLocaleString() : 'N/A'}</td>
                  <td><span style="background: ${yarn.status === 'active' ? '#d4edda' : yarn.status === 'inactive' ? '#f8d7da' : '#fff3cd'}; color: ${yarn.status === 'active' ? '#155724' : yarn.status === 'inactive' ? '#721c24' : '#856404'}; padding: 4px 8px; border-radius: 6px; font-weight: 600; text-transform: capitalize;">${yarn.status || 'N/A'}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ${paginationHTML}
        <p class="summary">Found ${totalCount.toLocaleString()} yarn catalog entries${totalCount > yarnCatalogs.results.length ? ` (showing ${yarnCatalogs.results.length} of ${totalCount} on page ${currentPage})` : ''}.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getYarnCatalog:', error);
    return generateHTMLResponse('Error', `Failed to retrieve yarn catalog: ${error.message}`);
  }
};

/**
 * Get recent PO status (last 3-5 purchase orders)
 * @param {Object} params - Parameters
 * @returns {Promise<string>} HTML string with recent PO status
 */
export const getRecentPOStatus = async (params = {}) => {
  try {
    const { limit = 3 } = params;
    
    // Get recent yarn requisitions with poSent: false (pending deliveries) - matching dashboard logic
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 90); // Last 90 days
    
    console.log(`[getRecentPOStatus] Fetching pending requisitions from ${startDate.toISOString()} to ${endDate.toISOString()}`);
    
    // Fetch yarn requisitions with poSent: false (pending deliveries)
    const requisitions = await yarnReqService.getYarnRequisitionList({
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      poSent: false, // Only pending deliveries (not yet sent as POs)
    });
    
    console.log(`[getRecentPOStatus] Found ${requisitions?.length || 0} pending requisitions`);
    
    // Service returns an array
    const requisitionsList = requisitions || [];
    
    // Sort by creation date descending and take the most recent
    const recentRequisitions = requisitionsList
      .sort((a, b) => {
        const dateA = new Date(a.created || a.createdAt || 0);
        const dateB = new Date(b.created || b.createdAt || 0);
        return dateB - dateA;
      })
      .slice(0, parseInt(limit) || 3);
    
    if (recentRequisitions.length === 0) {
      return generateHTMLResponse('No Recent PO Status', 'No pending purchase orders found.');
    }
    
    // Transform requisitions to match dashboard format
    const poWithTotals = recentRequisitions.map(req => {
      // Calculate quantity needed (minQty - availableQty) - allow negative values
      const quantity = (req.minQty || 0) - (req.availableQty || 0);
      
      // Generate PO number from requisition ID (matching dashboard logic)
      const poNumber = `PO-${(req._id || req.id || '').toString().slice(-6)}`;
      
      // Expected date: 30 days from creation date (matching dashboard logic)
      const expectedDate = req.created 
        ? new Date(new Date(req.created).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        : 'N/A';
      
      // Get yarn name
      const yarnName = req.yarn?.yarnName || req.yarnName || 'N/A';
      
      return {
        poNumber,
        totalQuantity: quantity,
        expectedDate,
        supplier: 'Supplier', // Default as in dashboard
        yarnName,
        yarnDetails: yarnName,
        yarnCount: 1,
      };
    });
    
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>📋 Recent PO Status (${recentRequisitions.length})</h3>
        <div class="chart-container">
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>PO Number</th>
                  <th>Total Quantity (KG)</th>
                  <th>Expected Date</th>
                  <th>Supplier</th>
                  <th>Yarn Details</th>
                </tr>
              </thead>
              <tbody>
                ${poWithTotals.map((po) => `
                  <tr>
                    <td><strong>${po.poNumber || 'N/A'}</strong></td>
                    <td>${po.totalQuantity.toLocaleString()} kg</td>
                    <td>${po.expectedDate}</td>
                    <td>${po.supplier || 'N/A'}</td>
                    <td><span style="color: #6366f1; font-size: 0.875rem;">${po.yarnDetails}</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        <p class="summary">Showing ${recentRequisitions.length} pending purchase orders (requisitions not yet sent as POs).</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getRecentPOStatus:', error);
    return generateHTMLResponse('Error', `Failed to retrieve recent PO status: ${error.message}`);
  }
};

/**
 * Get live inventory (inventory only, without PO status)
 * @param {Object} params - Parameters
 * @returns {Promise<string>} HTML string with live inventory
 */
export const getLiveInventory = async (params = {}) => {
  try {
    const { yarnId, limit = 50 } = params;
    
    let filters = {};
    if (yarnId) {
      filters.yarn_id = yarnId;
    }
    
    const inventories = await yarnInventoryService.queryYarnInventories(filters, { limit: parseInt(limit) || 50 });
    
    if (!inventories.results || inventories.results.length === 0) {
      return generateHTMLResponse('No Inventory Found', 'No yarn inventory entries found.');
    }
    
    // Calculate totals from the actual response structure
    const totalNetWeight = inventories.results.reduce((sum, inv) => {
      const lt = inv.longTermStorage?.netWeight || 0;
      const st = inv.shortTermStorage?.netWeight || 0;
      return sum + lt + st;
    }, 0);
    
    const totalCones = inventories.results.reduce((sum, inv) => {
      const lt = inv.longTermStorage?.numberOfCones || 0;
      const st = inv.shortTermStorage?.numberOfCones || 0;
      return sum + lt + st;
    }, 0);
    
    const totalWeight = inventories.results.reduce((sum, inv) => {
      const lt = inv.longTermStorage?.totalWeight || 0;
      const st = inv.shortTermStorage?.totalWeight || 0;
      return sum + lt + st;
    }, 0);
    
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>📦 Live Inventory (${inventories.results.length})</h3>
        <div class="kpi-grid">
          <div class="kpi-item">
            <div class="kpi-label">Total Net Weight</div>
            <div class="kpi-value">${totalNetWeight.toLocaleString()}</div>
            <div class="kpi-change">kg</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Total Weight</div>
            <div class="kpi-value">${totalWeight.toLocaleString()}</div>
            <div class="kpi-change">kg</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Total Cones</div>
            <div class="kpi-value">${totalCones.toLocaleString()}</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Inventory Items</div>
            <div class="kpi-value">${inventories.results.length}</div>
          </div>
        </div>
        <div class="chart-container">
          <h4>📋 Live Inventory</h4>
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Yarn Name</th>
                  <th>Weight (kg)</th>
                  <th>Cones (Long-term)</th>
                  <th>Cones (Short-term)</th>
                  <th>Blocked Qty</th>
                  <th>Available Qty</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${inventories.results.slice(0, 20).map((inv) => {
                  const lt = inv.longTermStorage || {};
                  const st = inv.shortTermStorage || {};
                  
                  // Weight (kg) = totalWeight (sum of totalWeight from LTS and STS) - matching dashboard
                  const weight = (lt.totalWeight || 0) + (st.totalWeight || 0);
                  
                  // Total Net Weight = sum of netWeight from LTS and STS (for available calculation)
                  const totalNetWeight = (lt.netWeight || 0) + (st.netWeight || 0);
                  
                  // Blocked Qty = blockedNetWeight from inventory (can be negative) - matching dashboard
                  const blockedQty = inv.blockedNetWeight || 0;
                  
                  // Available Qty = max(0, totalNetWeight - blockedQty) - matching dashboard logic
                  const availableQty = Math.max(0, totalNetWeight - blockedQty);
                  
                  return `
                  <tr>
                    <td><strong>${inv.yarnName || 'N/A'}</strong></td>
                    <td>${weight.toLocaleString()} kg</td>
                    <td>${(lt.numberOfCones || 0).toLocaleString()}</td>
                    <td>${(st.numberOfCones || 0).toLocaleString()}</td>
                    <td><span style="color: #ea580c; font-weight: 500;">${blockedQty.toLocaleString()} kg</span></td>
                    <td><span style="color: #16a34a; font-weight: 500;">${availableQty.toLocaleString()} kg</span></td>
                    <td><span style="background: ${inv.inventoryStatus === 'in_stock' ? '#d4edda' : inv.inventoryStatus === 'low_stock' ? '#fff3cd' : '#f8d7da'}; padding: 4px 8px; border-radius: 4px; font-weight: 500;">${inv.inventoryStatus ? inv.inventoryStatus.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'N/A'}</span></td>
                  </tr>
                `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
        <p class="summary">Showing ${Math.min(inventories.results.length, 20)} of ${inventories.results.length} inventory entries${inventories.totalResults > inventories.results.length ? ` (total: ${inventories.totalResults})` : ''}.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getLiveInventory:', error);
    return generateHTMLResponse('Error', `Failed to retrieve live inventory: ${error.message}`);
  }
};

/**
 * Get yarn inventory (with Recent PO Status included)
 * @param {Object} params - Parameters
 * @returns {Promise<string>} HTML string with yarn inventory and recent PO status
 */
export const getYarnInventory = async (params = {}) => {
  try {
    const { yarnId, limit = 50 } = params;
    
    // Fetch recent PO status (last 3) - using yarn requisitions with poSent: false (matching dashboard)
    let recentPOSection = '';
    try {
      // Get pending requisitions (last 90 days) - matching dashboard logic
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 90);
      
      console.log(`[getYarnInventory] Fetching pending requisitions from ${startDate.toISOString()} to ${endDate.toISOString()}`);
      
      const requisitions = await yarnReqService.getYarnRequisitionList({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        poSent: false, // Only pending deliveries
      });
      
      console.log(`[getYarnInventory] Found ${requisitions?.length || 0} pending requisitions`);
      
      // Service returns an array
      const requisitionsList = requisitions || [];
      const sortedRequisitions = requisitionsList
        .sort((a, b) => {
          const dateA = new Date(a.created || a.createdAt || 0);
          const dateB = new Date(b.created || b.createdAt || 0);
          return dateB - dateA;
        })
        .slice(0, 3);
      
      if (sortedRequisitions.length > 0) {
        const poWithTotals = sortedRequisitions.map(req => {
          // Calculate quantity needed (minQty - availableQty) - allow negative values
          const totalQuantity = (req.minQty || 0) - (req.availableQty || 0);
          
          // Generate PO number from requisition ID (matching dashboard logic)
          const poNumber = `PO-${(req._id || req.id || '').toString().slice(-6)}`;
          
          // Expected date: 30 days from creation date (matching dashboard logic)
          const expectedDate = req.created 
            ? new Date(new Date(req.created).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
            : 'N/A';
          
          // Get yarn name
          const yarnName = req.yarn?.yarnName || req.yarnName || 'N/A';
          
          return {
            poNumber,
            totalQuantity,
            expectedDate,
            supplier: 'Supplier', // Default as in dashboard
            yarnDetails: yarnName,
          };
        });
        
        recentPOSection = `
          <div class="chart-container" style="margin-bottom: 30px;">
            <h4>📋 Recent PO Status (${sortedRequisitions.length})</h4>
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>PO Number</th>
                    <th>Total Quantity (KG)</th>
                    <th>Expected Date</th>
                    <th>Supplier</th>
                    <th>Yarn Details</th>
                  </tr>
                </thead>
                <tbody>
                  ${poWithTotals.map((po) => `
                    <tr>
                      <td><strong>${po.poNumber || 'N/A'}</strong></td>
                      <td>${po.totalQuantity.toLocaleString()} kg</td>
                      <td>${po.expectedDate}</td>
                      <td>${po.supplier || 'N/A'}</td>
                      <td><span style="color: #6366f1; font-size: 0.875rem;">${po.yarnDetails}</span></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `;
      } else {
        // Try with 1 year range if no POs in 90 days
        console.log(`[getYarnInventory] No POs found in last 90 days, trying last year...`);
        try {
          const yearStartDate = new Date();
          yearStartDate.setFullYear(yearStartDate.getFullYear() - 1);
          
          const allPOs = await yarnPurchaseOrderService.getPurchaseOrders({
            startDate: yearStartDate.toISOString(),
            endDate: endDate.toISOString(),
          });
          
          console.log(`[getYarnInventory] Found ${allPOs?.length || 0} purchase orders in last year`);
          
          const yearSortedPOs = (allPOs || [])
            .sort((a, b) => {
              const dateA = new Date(a.createDate || a.createdAt || 0);
              const dateB = new Date(b.createDate || b.createdAt || 0);
              return dateB - dateA;
            })
            .slice(0, 3);
          
          if (yearSortedPOs.length > 0) {
            const poWithTotals = yearSortedPOs.map(po => {
              const totalQuantity = po.poItems?.reduce((sum, item) => sum + (item.quantity || 0), 0) || 0;
              const expectedDate = po.poItems?.[0]?.estimatedDeliveryDate 
                ? new Date(po.poItems[0].estimatedDeliveryDate).toISOString().split('T')[0]
                : po.createDate 
                  ? new Date(new Date(po.createDate).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
                  : 'N/A';
              
              return {
                ...po,
                totalQuantity,
                expectedDate,
              };
            });
            
            recentPOSection = `
              <div class="chart-container" style="margin-bottom: 30px;">
                <h4>📋 Recent PO Status (${yearSortedPOs.length})</h4>
                <div class="table-container">
                  <table class="data-table">
                    <thead>
                      <tr>
                        <th>PO Number</th>
                        <th>Total Quantity (KG)</th>
                        <th>Expected Date</th>
                        <th>Supplier</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${poWithTotals.map((po) => `
                        <tr>
                          <td><strong>${po.poNumber || 'N/A'}</strong></td>
                          <td>${po.totalQuantity.toLocaleString()} kg</td>
                          <td>${po.expectedDate}</td>
                          <td>${po.supplier?.brandName || po.supplierName || 'N/A'}</td>
                          <td><span style="background: ${po.currentStatus === 'goods_received' ? '#d4edda' : po.currentStatus === 'in_transit' ? '#d1ecf1' : '#fff3cd'}; padding: 4px 8px; border-radius: 4px; font-weight: 500;">${po.currentStatus ? po.currentStatus.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'N/A'}</span></td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              </div>
            `;
          }
        } catch (yearError) {
          console.error('[getYarnInventory] Error fetching POs from last year:', yearError);
        }
      }
    } catch (poError) {
      console.error('[getYarnInventory] Error fetching recent PO status:', poError);
      console.error('[getYarnInventory] Error details:', {
        message: poError.message,
        stack: poError.stack
      });
      // Continue without PO section if there's an error
      // Optionally show a message that PO status couldn't be loaded
      recentPOSection = `
        <div class="chart-container" style="margin-bottom: 30px; opacity: 0.7;">
          <h4>📋 Recent PO Status</h4>
          <p style="color: #94a3b8; padding: 10px;">Unable to load recent purchase order status. Please try "recent po status" command separately.</p>
        </div>
      `;
    }
    
    let filters = {};
    if (yarnId) {
      filters.yarn_id = yarnId;
    }
    
    const inventories = await yarnInventoryService.queryYarnInventories(filters, { limit: parseInt(limit) || 50 });
    
    if (!inventories.results || inventories.results.length === 0) {
      return generateHTMLResponse('No Inventory Found', 'No yarn inventory entries found.');
    }
    
    // Calculate totals from the actual response structure
    const totalNetWeight = inventories.results.reduce((sum, inv) => {
      const lt = inv.longTermStorage?.netWeight || 0;
      const st = inv.shortTermStorage?.netWeight || 0;
      return sum + lt + st;
    }, 0);
    
    const totalCones = inventories.results.reduce((sum, inv) => {
      const lt = inv.longTermStorage?.numberOfCones || 0;
      const st = inv.shortTermStorage?.numberOfCones || 0;
      return sum + lt + st;
    }, 0);
    
    const totalWeight = inventories.results.reduce((sum, inv) => {
      const lt = inv.longTermStorage?.totalWeight || 0;
      const st = inv.shortTermStorage?.totalWeight || 0;
      return sum + lt + st;
    }, 0);
    
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>📦 Yarn Inventory</h3>
        ${recentPOSection}
        <div class="kpi-grid">
          <div class="kpi-item">
            <div class="kpi-label">Total Net Weight</div>
            <div class="kpi-value">${totalNetWeight.toLocaleString()}</div>
            <div class="kpi-change">kg</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Total Weight</div>
            <div class="kpi-value">${totalWeight.toLocaleString()}</div>
            <div class="kpi-change">kg</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Total Cones</div>
            <div class="kpi-value">${totalCones.toLocaleString()}</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Inventory Items</div>
            <div class="kpi-value">${inventories.results.length}</div>
          </div>
        </div>
        <div class="chart-container">
          <h4>📋 Live Inventory (${inventories.results.length})</h4>
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Yarn Name</th>
                  <th>Weight (kg)</th>
                  <th>Cones (Long-term)</th>
                  <th>Cones (Short-term)</th>
                  <th>Blocked Qty</th>
                  <th>Available Qty</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${inventories.results.slice(0, 20).map((inv) => {
                  const lt = inv.longTermStorage || {};
                  const st = inv.shortTermStorage || {};
                  
                  // Weight (kg) = totalWeight (sum of totalWeight from LTS and STS) - matching dashboard
                  const weight = (lt.totalWeight || 0) + (st.totalWeight || 0);
                  
                  // Total Net Weight = sum of netWeight from LTS and STS (for available calculation)
                  const totalNetWeight = (lt.netWeight || 0) + (st.netWeight || 0);
                  
                  // Blocked Qty = blockedNetWeight from inventory (can be negative) - matching dashboard
                  const blockedQty = inv.blockedNetWeight || 0;
                  
                  // Available Qty = max(0, totalNetWeight - blockedQty) - matching dashboard logic
                  const availableQty = Math.max(0, totalNetWeight - blockedQty);
                  
                  return `
                  <tr>
                    <td><strong>${inv.yarnName || 'N/A'}</strong></td>
                    <td>${weight.toLocaleString()} kg</td>
                    <td>${(lt.numberOfCones || 0).toLocaleString()}</td>
                    <td>${(st.numberOfCones || 0).toLocaleString()}</td>
                    <td><span style="color: #ea580c; font-weight: 500;">${blockedQty.toLocaleString()} kg</span></td>
                    <td><span style="color: #16a34a; font-weight: 500;">${availableQty.toLocaleString()} kg</span></td>
                    <td><span style="background: ${inv.inventoryStatus === 'in_stock' ? '#d4edda' : inv.inventoryStatus === 'low_stock' ? '#fff3cd' : '#f8d7da'}; padding: 4px 8px; border-radius: 4px; font-weight: 500;">${inv.inventoryStatus ? inv.inventoryStatus.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'N/A'}</span></td>
                  </tr>
                `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
        <p class="summary">Showing ${Math.min(inventories.results.length, 20)} of ${inventories.results.length} inventory entries${inventories.totalResults > inventories.results.length ? ` (total: ${inventories.totalResults})` : ''}.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getYarnInventory:', error);
    return generateHTMLResponse('Error', `Failed to retrieve yarn inventory: ${error.message}`);
  }
};

/**
 * Get yarn transactions
 * @param {Object} params - Parameters with optional period
 * @returns {Promise<string>} HTML string with yarn transactions
 */
export const getYarnTransactions = async (params = {}) => {
  try {
    const { 
      limit = 50, 
      page = 1,
      yarnId,
      yarnName,
      transactionType,
      transactionDate,
      orderno,
      dateFrom,
      dateTo
    } = params;
    
    // Build filter object - support ALL fields
    const filters = {};
    if (yarnId) {
      filters.yarn_id = yarnId;
    }
    if (yarnName) {
      filters.yarn_name = yarnName;
    }
    if (transactionType) {
      filters.transaction_type = transactionType;
    }
    if (orderno) {
      filters.orderno = orderno;
    }
    if (dateFrom || dateTo) {
      filters.start_date = dateFrom;
      filters.end_date = dateTo;
    }
    
    const transactions = await yarnTransactionService.queryYarnTransactions(filters);
    
    if (!transactions || transactions.length === 0) {
      const filterSummary = Object.keys(filters).length > 0 
        ? ` matching filters: ${Object.keys(filters).join(', ')}` 
        : '';
      return generateHTMLResponse('No Transactions Found', `No yarn transactions found${filterSummary}.`);
    }
    
    // Pagination
    const currentPage = parseInt(page) || 1;
    const pageLimit = parseInt(limit) || 50;
    const totalCount = transactions.length;
    const totalPages = Math.ceil(totalCount / pageLimit);
    const startIndex = (currentPage - 1) * pageLimit;
    const endIndex = startIndex + pageLimit;
    const paginatedTransactions = transactions.slice(startIndex, endIndex);
    
    // Calculate summary statistics
    const transactionTypes = [...new Set(transactions.map(t => t.transactionType).filter(Boolean))];
    const totalNetWeight = transactions.reduce((sum, t) => sum + (t.transactionNetWeight || 0), 0);
    const totalCones = transactions.reduce((sum, t) => sum + (t.transactionConeCount || 0), 0);
    const typeCounts = {};
    transactionTypes.forEach(type => {
      typeCounts[type] = transactions.filter(t => t.transactionType === type).length;
    });
    
    // Build filter summary
    const appliedFilters = [];
    if (yarnId) appliedFilters.push(`Yarn ID: ${yarnId}`);
    if (yarnName) appliedFilters.push(`Yarn Name: ${yarnName}`);
    if (transactionType) appliedFilters.push(`Type: ${transactionType}`);
    if (orderno) appliedFilters.push(`Order No: ${orderno}`);
    if (dateFrom) appliedFilters.push(`From: ${dateFrom}`);
    if (dateTo) appliedFilters.push(`To: ${dateTo}`);
    const filterSummaryHTML = appliedFilters.length > 0 
      ? `<p style="margin: 10px 0; padding: 10px; background: #e3f2fd; border-radius: 4px; color: #1976d2;"><strong>Filters Applied:</strong> ${appliedFilters.join(', ')}</p>` 
      : '';
    
    // Format transaction type for display
    const formatTransactionType = (type) => {
      const typeMap = {
        'yarn_issued': 'Issued',
        'yarn_blocked': 'Blocked',
        'yarn_stocked': 'Stocked',
        'internal_transfer': 'Internal Transfer',
        'yarn_returned': 'Returned'
      };
      return typeMap[type] || type?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'N/A';
    };
    
    const paginationHTML = totalPages > 1 
      ? generatePaginationHTML(currentPage, totalPages, totalCount, 'yarn transactions')
      : '';
    
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>📋 Yarn Transactions</h3>
        ${filterSummaryHTML}
        
        <!-- Summary KPIs -->
        <div class="kpi-grid">
          <div class="kpi-item">
            <div class="kpi-label">Total Transactions</div>
            <div class="kpi-value">${totalCount.toLocaleString()}</div>
            <div class="kpi-change">In System</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Total Net Weight</div>
            <div class="kpi-value">${totalNetWeight.toLocaleString()}</div>
            <div class="kpi-change">kg</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Total Cones</div>
            <div class="kpi-value">${totalCones.toLocaleString()}</div>
            <div class="kpi-change">Cones</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Transaction Types</div>
            <div class="kpi-value">${transactionTypes.length}</div>
            <div class="kpi-change">Unique Types</div>
          </div>
        </div>
        
        <!-- Transaction Types Breakdown -->
        ${transactionTypes.length > 0 ? `
        <div class="chart-container">
          <h4>📊 Transaction Types Breakdown</h4>
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Transaction Type</th>
                  <th>Count</th>
                </tr>
              </thead>
              <tbody>
                ${transactionTypes.map(type => `
                  <tr>
                    <td><strong>${formatTransactionType(type)}</strong></td>
                    <td>${typeCounts[type]}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        ` : ''}
        
        <!-- Transactions Table -->
        <div class="chart-container">
          <h4>📋 Transactions List${totalPages > 1 ? ` (Page ${currentPage} of ${totalPages})` : ''}</h4>
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Transaction Date</th>
                  <th>Yarn Name</th>
                  <th>Type</th>
                  <th>Net Weight (kg)</th>
                  <th>Total Weight (kg)</th>
                  <th>Cones</th>
                  <th>Order No</th>
                </tr>
              </thead>
              <tbody>
                ${paginatedTransactions.map((txn) => `
                  <tr>
                    <td>${txn.transactionDate ? new Date(txn.transactionDate).toLocaleString() : 'N/A'}</td>
                    <td><strong>${txn.yarnName || txn.yarn?.yarnName || 'N/A'}</strong></td>
                    <td><span style="background: ${txn.transactionType === 'yarn_issued' ? '#d4edda' : txn.transactionType === 'yarn_blocked' ? '#fff3cd' : txn.transactionType === 'yarn_stocked' ? '#cfe2ff' : txn.transactionType === 'yarn_returned' ? '#f8d7da' : '#e2e3e5'}; padding: 4px 8px; border-radius: 4px; font-weight: 500;">${formatTransactionType(txn.transactionType)}</span></td>
                    <td>${(txn.transactionNetWeight || 0).toLocaleString()}</td>
                    <td>${(txn.transactionTotalWeight || 0).toLocaleString()}</td>
                    <td>${(txn.transactionConeCount || 0).toLocaleString()}</td>
                    <td>${txn.orderno || 'N/A'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        
        ${paginationHTML}
        
        <p class="summary">Found ${totalCount.toLocaleString()} yarn transactions${totalPages > 1 ? ` (showing page ${currentPage} of ${totalPages}, ${paginatedTransactions.length} items per page)` : ''}.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getYarnTransactions:', error);
    return generateHTMLResponse('Error', `Failed to retrieve yarn transactions: ${error.message}`);
  }
};

/**
 * Get yarn requisitions
 * @param {Object} params - Parameters
 * @returns {Promise<string>} HTML string with yarn requisitions
 */
export const getYarnRequisitions = async (params = {}) => {
  try {
    const { period, limit = 50 } = params;
    
    // Set default date range (last 1 year if not specified to get all recent requisitions)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 1); // Default to last 1 year to get all requisitions
    
    // Ensure dates are valid before passing
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new Error('Failed to create valid date range');
    }
    
    let queryParams = {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString()
    };
    
    // If period is specified, adjust dates accordingly
    if (period) {
      // Add date filtering logic if needed
    }
    
    const requisitions = await yarnReqService.getYarnRequisitionList(queryParams);
    
    if (!requisitions || requisitions.length === 0) {
      return generateHTMLResponse('No Requisitions Found', 'No yarn requisitions found.');
    }
    
    const totalCount = requisitions.length;
    const poSentCount = requisitions.filter(r => r.poSent).length;
    const alertCount = requisitions.filter(r => r.alertStatus).length;
    
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>📝 Yarn Requisitions</h3>
        
        <div class="kpi-grid">
          <div class="kpi-item">
            <div class="kpi-label">Total Requisitions</div>
            <div class="kpi-value">${totalCount.toLocaleString()}</div>
            <div class="kpi-change">In System</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">PO Sent</div>
            <div class="kpi-value">${poSentCount.toLocaleString()}</div>
            <div class="kpi-change">Completed</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">With Alerts</div>
            <div class="kpi-value">${alertCount.toLocaleString()}</div>
            <div class="kpi-change">Require Attention</div>
          </div>
        </div>
        
        <div class="chart-container">
          <h4>📋 Requisitions List</h4>
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Created Date</th>
                  <th>Yarn Name</th>
                  <th>Min Qty</th>
                  <th>Available Qty</th>
                  <th>Blocked Qty</th>
                  <th>Alert Status</th>
                  <th>PO Sent</th>
                </tr>
              </thead>
              <tbody>
                ${requisitions.slice(0, parseInt(limit) || 20).map((req) => `
                  <tr>
                    <td>${req.created ? new Date(req.created).toLocaleDateString() : 'N/A'}</td>
                    <td>${req.yarn?.yarnName || req.yarnName || 'N/A'}</td>
                    <td>${(req.minQty || 0).toLocaleString()}</td>
                    <td>${(req.availableQty || 0).toLocaleString()}</td>
                    <td>${(req.blockedQty || 0).toLocaleString()}</td>
                    <td>${req.alertStatus ? req.alertStatus.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'N/A'}</td>
                    <td>${req.poSent ? 'Yes' : 'No'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        
        <p class="summary">Found ${totalCount.toLocaleString()} yarn requisitions${totalCount > (parseInt(limit) || 20) ? ` (showing ${Math.min(parseInt(limit) || 20, totalCount)} of ${totalCount})` : ''}.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getYarnRequisitions:', error);
    return generateHTMLResponse('Error', `Failed to retrieve yarn requisitions: ${error.message}`);
  }
};

/**
 * Get yarn issue records
 * @param {Object} params - Parameters
 * @returns {Promise<string>} HTML string with yarn issue records
 */
export const getYarnIssue = async (params = {}) => {
  try {
    const { limit = 50, orderNumber } = params;
    
    // Use getAllYarnIssued which has proper population and filtering support
    const filters = {};
    if (orderNumber) {
      filters.orderNumber = orderNumber;
    }
    
    console.log(`[getYarnIssue] Fetching yarn issue records with filters:`, JSON.stringify(filters, null, 2));
    const issuedTransactions = await yarnTransactionService.getAllYarnIssued(filters);
    console.log(`[getYarnIssue] Received ${Array.isArray(issuedTransactions) ? issuedTransactions.length : 0} transactions`);
    
    // getAllYarnIssued already handles yarn population and floor info attachment
    const processedTransactions = Array.isArray(issuedTransactions) ? issuedTransactions : [];
    
    // Always fetch yarn requirements from production orders (regardless of issued transactions)
    console.log(`[getYarnIssue] Fetching yarn requirements from production orders`);
    
    try {
      const orderQuery = orderNumber ? { orderNumber: orderNumber.toUpperCase() } : {};
      const orders = await ProductionOrder.find(orderQuery)
        .populate({
          path: 'articles',
          select: 'articleNumber plannedQuantity completedQuantity status priority linkingType progress remarks machineId',
          populate: {
            path: 'machineId',
            select: 'machineCode machineNumber model'
          }
        })
        .select('orderNumber currentFloor createdAt updatedAt priority status orderNote')
        .sort({ createdAt: -1 })
        .limit(parseInt(limit) || 50)
        .lean();
      
      console.log(`[getYarnIssue] Found ${orders.length} production orders with articles`);
      
      // Calculate yarn requirements from article BOMs and match with issued transactions
      const yarnRequirements = [];
      const ordersWithDetails = []; // Store full order details with articles
      const issuedByOrderAndYarn = new Map(); // Track issued quantities by orderNumber and yarnName
      
      // Build map of issued quantities
      processedTransactions.forEach(txn => {
        const key = `${txn.orderno || 'N/A'}|${txn.yarnName || 'Unknown'}`;
        const currentIssued = issuedByOrderAndYarn.get(key) || 0;
        issuedByOrderAndYarn.set(key, currentIssued + (txn.transactionNetWeight || 0));
      });
      
      if (orders.length > 0) {
        for (const order of orders) {
          // Store order details
          const orderDetails = {
            orderNumber: order.orderNumber,
            floor: order.currentFloor || 'N/A',
            priority: order.priority || 'N/A',
            status: order.status || 'N/A',
            createdAt: order.createdAt ? new Date(order.createdAt).toLocaleDateString() : 'N/A',
            updatedAt: order.updatedAt ? new Date(order.updatedAt).toLocaleDateString() : 'N/A',
            orderNote: order.orderNote || 'N/A',
            articles: [],
            yarnRequirements: []
          };
          
          if (!order.articles || order.articles.length === 0) {
            console.log(`[getYarnIssue] Order ${order.orderNumber} has no articles`);
            ordersWithDetails.push(orderDetails);
            continue;
          }
          
          console.log(`[getYarnIssue] Processing order ${order.orderNumber} with ${order.articles.length} articles`);
          const yarnReqMap = new Map(); // Aggregate by yarn name per order
          
          // Process each article
          for (const article of order.articles) {
            // Store article details
            const articleDetails = {
              articleNumber: article.articleNumber || 'N/A',
              plannedQuantity: article.plannedQuantity || 0,
              completedQuantity: article.completedQuantity || 0,
              status: article.status || 'N/A',
              priority: article.priority || 'N/A',
              linkingType: article.linkingType || 'N/A',
              progress: article.progress || 0,
              remarks: article.remarks || '',
              machine: article.machineId ? 
                `${article.machineId.machineCode || ''} ${article.machineId.machineNumber || ''}`.trim() || 'N/A' : 
                'N/A'
            };
            orderDetails.articles.push(articleDetails);
            
            if (!article.plannedQuantity || article.plannedQuantity === 0) {
              console.log(`[getYarnIssue] Article ${article.articleNumber} has zero planned quantity`);
              continue;
            }
            
            // Fetch product by articleNumber (similar to frontend)
            try {
              const product = await Product.findOne({ 
                softwareCode: article.articleNumber.toUpperCase() 
              })
                .populate({
                  path: 'bom.yarnCatalogId',
                  select: 'yarnName yarnType'
                })
                .select('bom styleCode')
                .lean();
              
              if (!product || !product.bom || product.bom.length === 0) {
                console.log(`[getYarnIssue] No product or BOM found for article ${article.articleNumber}`);
                continue;
              }
              
              console.log(`[getYarnIssue] Found product for article ${article.articleNumber} with ${product.bom.length} BOM items`);
              
              for (const bomItem of product.bom) {
                const yarnName = bomItem.yarnName || (bomItem.yarnCatalogId?.yarnName) || 'Unknown Yarn';
                const quantityPerUnit = bomItem.quantity || 0; // in grams
                const totalGrams = quantityPerUnit * article.plannedQuantity;
                const totalKg = totalGrams / 1000;
                
                if (yarnReqMap.has(yarnName)) {
                  const existing = yarnReqMap.get(yarnName);
                  existing.requiredQty += totalKg;
                } else {
                  yarnReqMap.set(yarnName, {
                    yarnName,
                    requiredQty: totalKg,
                    orderNumber: order.orderNumber,
                    floor: order.currentFloor || 'N/A'
                  });
                }
              }
            } catch (productError) {
              console.error(`[getYarnIssue] Error fetching product for article ${article.articleNumber}:`, productError.message);
              continue;
            }
          }
          
          // Add yarn requirements with issued quantities
          yarnReqMap.forEach((req) => {
            const key = `${req.orderNumber}|${req.yarnName}`;
            const issuedQty = issuedByOrderAndYarn.get(key) || 0;
            const requirement = {
              ...req,
              issuedQty: issuedQty,
              remainingQty: Math.max(0, req.requiredQty - issuedQty),
              status: issuedQty === 0 ? 'Not Issued' : (issuedQty >= req.requiredQty ? 'Issued' : 'Partially Issued')
            };
            yarnRequirements.push(requirement);
            orderDetails.yarnRequirements.push(requirement);
          });
          
          ordersWithDetails.push(orderDetails);
        }
      }
      
      // Now build the response combining issued transactions and requirements
      const limitedTransactions = processedTransactions.slice(0, parseInt(limit) || 50);
      const totalCount = processedTransactions.length;
      const totalNetWeight = limitedTransactions.reduce((sum, txn) => sum + (txn.transactionNetWeight || 0), 0);
      const totalCones = limitedTransactions.reduce((sum, txn) => sum + (txn.transactionConeCount || 0), 0);
      
      // Calculate totals from requirements
      const totalRequired = yarnRequirements.reduce((sum, r) => sum + r.requiredQty, 0);
      const totalIssued = yarnRequirements.reduce((sum, r) => sum + r.issuedQty, 0);
      const totalRemaining = yarnRequirements.reduce((sum, r) => sum + r.remainingQty, 0);
      const uniqueOrders = [...new Set(yarnRequirements.map(r => r.orderNumber))];
      
      // Build HTML for orders with full details
      let ordersHtml = '';
      ordersWithDetails.forEach((orderData) => {
        const statusColor = orderData.status === 'Completed' ? '#d4edda' : orderData.status === 'In Progress' ? '#d1ecf1' : orderData.status === 'On Hold' ? '#fff3cd' : orderData.status === 'Cancelled' ? '#f8d7da' : '#e2e3e5';
        const statusTextColor = orderData.status === 'Completed' ? '#155724' : orderData.status === 'In Progress' ? '#0c5460' : orderData.status === 'On Hold' ? '#856404' : orderData.status === 'Cancelled' ? '#721c24' : '#383d41';
        const priorityColor = orderData.priority === 'Urgent' ? '#f8d7da' : orderData.priority === 'High' ? '#fff3cd' : orderData.priority === 'Medium' ? '#d1ecf1' : '#e2e3e5';
        
        // Calculate order totals
        const totalPlannedQty = orderData.articles.reduce((sum, art) => sum + (art.plannedQuantity || 0), 0);
        const totalCompletedQty = orderData.articles.reduce((sum, art) => sum + (art.completedQuantity || 0), 0);
        const orderTotalRequired = orderData.yarnRequirements.reduce((sum, r) => sum + r.requiredQty, 0);
        const orderTotalIssued = orderData.yarnRequirements.reduce((sum, r) => sum + r.issuedQty, 0);
        
        ordersHtml += `
          <div style="margin-bottom: 30px; padding: 20px; background: rgba(59, 130, 246, 0.05); border-left: 4px solid #3b82f6; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 15px;">
              <div>
                <h3 style="margin: 0 0 5px 0; color: #1e40af; font-size: 1.3em;">📋 Order ${orderData.orderNumber}</h3>
                <div style="display: flex; gap: 15px; flex-wrap: wrap; margin-top: 8px;">
                  <span style="background: ${statusColor}; color: ${statusTextColor}; padding: 4px 10px; border-radius: 4px; font-weight: 500; font-size: 0.9em;">${orderData.status}</span>
                  <span style="background: ${priorityColor}; padding: 4px 10px; border-radius: 4px; font-weight: 500; font-size: 0.9em;">${orderData.priority}</span>
                  <span style="background: #e3f2fd; padding: 4px 10px; border-radius: 4px; font-weight: 500; font-size: 0.9em;">${orderData.floor}</span>
                </div>
              </div>
              <div style="text-align: right; color: #64748b; font-size: 0.9em;">
                <div>Created: ${orderData.createdAt}</div>
                <div>Updated: ${orderData.updatedAt}</div>
              </div>
            </div>
            
            ${orderData.orderNote && orderData.orderNote !== 'N/A' ? `
              <div style="background: #f8f9fa; padding: 10px; border-radius: 4px; margin-bottom: 15px;">
                <strong>Notes:</strong> ${orderData.orderNote}
              </div>
            ` : ''}
            
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 20px;">
              <div style="background: white; padding: 10px; border-radius: 4px; border: 1px solid #e2e8f0;">
                <div style="color: #64748b; font-size: 0.85em;">Articles</div>
                <div style="font-size: 1.2em; font-weight: bold; color: #1e293b;">${orderData.articles.length}</div>
              </div>
              <div style="background: white; padding: 10px; border-radius: 4px; border: 1px solid #e2e8f0;">
                <div style="color: #64748b; font-size: 0.85em;">Planned Qty</div>
                <div style="font-size: 1.2em; font-weight: bold; color: #1e293b;">${totalPlannedQty.toLocaleString()}</div>
              </div>
              <div style="background: white; padding: 10px; border-radius: 4px; border: 1px solid #e2e8f0;">
                <div style="color: #64748b; font-size: 0.85em;">Completed Qty</div>
                <div style="font-size: 1.2em; font-weight: bold; color: #1e293b;">${totalCompletedQty.toLocaleString()}</div>
              </div>
              <div style="background: white; padding: 10px; border-radius: 4px; border: 1px solid #e2e8f0;">
                <div style="color: #64748b; font-size: 0.85em;">Yarn Required</div>
                <div style="font-size: 1.2em; font-weight: bold; color: #1e293b;">${orderTotalRequired.toFixed(2)} kg</div>
              </div>
              <div style="background: white; padding: 10px; border-radius: 4px; border: 1px solid #e2e8f0;">
                <div style="color: #64748b; font-size: 0.85em;">Yarn Issued</div>
                <div style="font-size: 1.2em; font-weight: bold; color: #1e293b;">${orderTotalIssued.toFixed(2)} kg</div>
              </div>
            </div>
            
            ${orderData.articles.length > 0 ? `
              <div style="margin-bottom: 20px;">
                <h4 style="margin: 0 0 10px 0; color: #334155; font-size: 1.1em;">📦 Articles (${orderData.articles.length})</h4>
                <div class="table-container">
                  <table class="data-table">
                    <thead>
                      <tr>
                        <th>Article Number</th>
                        <th>Status</th>
                        <th>Priority</th>
                        <th>Linking Type</th>
                        <th>Planned Qty</th>
                        <th>Completed Qty</th>
                        <th>Progress</th>
                        <th>Machine</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${orderData.articles.map(art => {
                        const artStatusColor = art.status === 'Completed' ? '#d4edda' : art.status === 'In Progress' ? '#d1ecf1' : '#fff3cd';
                        const artStatusTextColor = art.status === 'Completed' ? '#155724' : art.status === 'In Progress' ? '#0c5460' : '#856404';
                        return `
                          <tr>
                            <td><strong>${art.articleNumber}</strong></td>
                            <td><span style="background: ${artStatusColor}; color: ${artStatusTextColor}; padding: 4px 8px; border-radius: 4px; font-weight: 500; font-size: 0.85em;">${art.status}</span></td>
                            <td>${art.priority}</td>
                            <td>${art.linkingType}</td>
                            <td>${art.plannedQuantity.toLocaleString()}</td>
                            <td>${art.completedQuantity.toLocaleString()}</td>
                            <td>${art.progress}%</td>
                            <td>${art.machine}</td>
                          </tr>
                        `;
                      }).join('')}
                    </tbody>
                  </table>
                </div>
              </div>
            ` : ''}
            
            ${orderData.yarnRequirements.length > 0 ? `
              <div>
                <h4 style="margin: 0 0 10px 0; color: #334155; font-size: 1.1em;">🧵 Yarn Requirements (${orderData.yarnRequirements.length})</h4>
                <div class="table-container">
                  <table class="data-table">
                    <thead>
                      <tr>
                        <th>Yarn Name</th>
                        <th>Required (kg)</th>
                        <th>Issued (kg)</th>
                        <th>Remaining (kg)</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${orderData.yarnRequirements.map(req => {
                        const statusColor = req.status === 'Issued' ? '#d4edda' : req.status === 'Partially Issued' ? '#d1ecf1' : '#fff3cd';
                        const statusTextColor = req.status === 'Issued' ? '#155724' : req.status === 'Partially Issued' ? '#0c5460' : '#856404';
                        return `
                          <tr>
                            <td><strong>${req.yarnName}</strong></td>
                            <td>${req.requiredQty.toFixed(2)}</td>
                            <td>${req.issuedQty.toFixed(2)}</td>
                            <td>${req.remainingQty.toFixed(2)}</td>
                            <td><span style="background: ${statusColor}; color: ${statusTextColor}; padding: 4px 8px; border-radius: 4px; font-weight: 500;">${req.status}</span></td>
                          </tr>
                        `;
                      }).join('')}
                    </tbody>
                  </table>
                </div>
              </div>
            ` : '<p style="color: #64748b; font-style: italic;">No yarn requirements found for this order.</p>'}
          </div>
        `;
      });
      
      // Build transactions HTML if any exist
      let transactionsHtml = '';
      if (limitedTransactions.length > 0) {
        transactionsHtml = `
          <div class="chart-container" style="margin-top: 30px;">
            <h4>📤 Yarn Issue Transactions</h4>
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Issue Date</th>
                    <th>Yarn Name</th>
                    <th>Order No</th>
                    <th>Floor</th>
                    <th>Net Weight (kg)</th>
                    <th>Total Weight (kg)</th>
                    <th>Cones</th>
                  </tr>
                </thead>
                <tbody>
                  ${limitedTransactions.map((txn) => `
                    <tr>
                      <td>${txn.transactionDate ? new Date(txn.transactionDate).toLocaleDateString() : 'N/A'}</td>
                      <td>${txn.yarnName || txn.yarn?.yarnName || 'N/A'}</td>
                      <td><strong>${txn.orderno || 'N/A'}</strong></td>
                      <td><span style="background: #e3f2fd; padding: 4px 8px; border-radius: 4px; font-weight: 500;">${txn.floor || 'N/A'}</span></td>
                      <td>${(txn.transactionNetWeight || 0).toFixed(2)}</td>
                      <td>${(txn.transactionTotalWeight || 0).toFixed(2)}</td>
                      <td>${(txn.transactionConeCount || 0).toLocaleString()}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `;
      }
      
      return AI_TOOL_STYLES + `
        <div class="ai-tool-response">
          <h3>📤 Yarn Issue Status${orderNumber ? ` - Order ${orderNumber}` : ''}</h3>
          
          ${processedTransactions.length === 0 ? `
            <div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; padding: 15px; margin-bottom: 20px;">
              <strong>ℹ️ No Yarn Has Been Issued Yet</strong>
              <p style="margin: 10px 0 0 0;">Showing yarn requirements from production orders. Yarn needs to be issued through the Yarn Issue page.</p>
            </div>
          ` : ''}
          
          <div class="kpi-grid">
            <div class="kpi-item">
              <div class="kpi-label">Total Orders</div>
              <div class="kpi-value">${ordersWithDetails.length}</div>
              <div class="kpi-change">Production Orders</div>
            </div>
            <div class="kpi-item">
              <div class="kpi-label">Total Articles</div>
              <div class="kpi-value">${ordersWithDetails.reduce((sum, o) => sum + o.articles.length, 0)}</div>
              <div class="kpi-change">Articles</div>
            </div>
            <div class="kpi-item">
              <div class="kpi-label">Orders with Requirements</div>
              <div class="kpi-value">${uniqueOrders.length}</div>
              <div class="kpi-change">Orders</div>
            </div>
            <div class="kpi-item">
              <div class="kpi-label">Total Required</div>
              <div class="kpi-value">${totalRequired.toFixed(2)}</div>
              <div class="kpi-change">kg</div>
            </div>
            <div class="kpi-item">
              <div class="kpi-label">Total Issued</div>
              <div class="kpi-value">${totalIssued.toFixed(2)}</div>
              <div class="kpi-change">kg</div>
            </div>
            <div class="kpi-item">
              <div class="kpi-label">Remaining</div>
              <div class="kpi-value">${totalRemaining.toFixed(2)}</div>
              <div class="kpi-change">kg</div>
            </div>
            ${processedTransactions.length > 0 ? `
              <div class="kpi-item">
                <div class="kpi-label">Transactions</div>
                <div class="kpi-value">${totalCount}</div>
                <div class="kpi-change">Records</div>
              </div>
            ` : ''}
          </div>
          
          <div class="chart-container">
            <h4>📋 Production Orders with Articles and Yarn Requirements</h4>
            ${ordersHtml || '<p>No production orders found.</p>'}
          </div>
          
          ${transactionsHtml}
          
          <p class="summary">Showing ${ordersWithDetails.length} production order(s) with ${ordersWithDetails.reduce((sum, o) => sum + o.articles.length, 0)} total articles. Yarn requirements calculated from production order BOMs${processedTransactions.length > 0 ? ` and ${totalCount} issued transaction(s)` : ''}. ${totalRemaining > 0 ? `There is ${totalRemaining.toFixed(2)} kg remaining to be issued.` : ordersWithDetails.length > 0 ? 'All required yarn has been issued.' : 'No yarn requirements found.'}</p>
        </div>
      `;
    } catch (error) {
      console.error('[getYarnIssue] Error fetching yarn requirements:', error);
      // Fall back to showing just transactions if requirements fetch fails
      if (processedTransactions.length > 0) {
        // Show transactions only
        const limitedTransactions = processedTransactions.slice(0, parseInt(limit) || 50);
        const totalCount = processedTransactions.length;
        const totalNetWeight = limitedTransactions.reduce((sum, txn) => sum + (txn.transactionNetWeight || 0), 0);
        const totalCones = limitedTransactions.reduce((sum, txn) => sum + (txn.transactionConeCount || 0), 0);
        
        const transactionsHtml = `
          <div class="chart-container">
            <h4>📋 Yarn Issue Records</h4>
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Issue Date</th>
                    <th>Yarn Name</th>
                    <th>Order No</th>
                    <th>Floor</th>
                    <th>Net Weight (kg)</th>
                    <th>Total Weight (kg)</th>
                    <th>Cones</th>
                  </tr>
                </thead>
                <tbody>
                  ${limitedTransactions.map((txn) => `
                    <tr>
                      <td>${txn.transactionDate ? new Date(txn.transactionDate).toLocaleDateString() : 'N/A'}</td>
                      <td>${txn.yarnName || txn.yarn?.yarnName || 'N/A'}</td>
                      <td><strong>${txn.orderno || 'N/A'}</strong></td>
                      <td><span style="background: #e3f2fd; padding: 4px 8px; border-radius: 4px; font-weight: 500;">${txn.floor || 'N/A'}</span></td>
                      <td>${(txn.transactionNetWeight || 0).toLocaleString()}</td>
                      <td>${(txn.transactionTotalWeight || 0).toLocaleString()}</td>
                      <td>${(txn.transactionConeCount || 0).toLocaleString()}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `;
        
        return AI_TOOL_STYLES + `
          <div class="ai-tool-response">
            <h3>📤 Yarn Issue${orderNumber ? ` - Order ${orderNumber}` : ''}</h3>
            
            <div class="kpi-grid">
              <div class="kpi-item">
                <div class="kpi-label">Total Issues</div>
                <div class="kpi-value">${totalCount.toLocaleString()}</div>
                <div class="kpi-change">Records</div>
              </div>
              <div class="kpi-item">
                <div class="kpi-label">Total Net Weight</div>
                <div class="kpi-value">${totalNetWeight.toLocaleString()}</div>
                <div class="kpi-change">kg</div>
              </div>
              <div class="kpi-item">
                <div class="kpi-label">Total Cones</div>
                <div class="kpi-value">${totalCones.toLocaleString()}</div>
                <div class="kpi-change">Issued</div>
              </div>
            </div>
            
            ${transactionsHtml}
            
            <p class="summary">Found ${totalCount.toLocaleString()} yarn issue records${totalCount > limitedTransactions.length ? ` (showing ${limitedTransactions.length} of ${totalCount})` : ''} with total net weight of ${totalNetWeight.toLocaleString()} kg and ${totalCones.toLocaleString()} cones issued.${orderNumber ? ` Filtered by order number: ${orderNumber}` : ''}</p>
          </div>
        `;
      } else {
        return generateHTMLResponse('Error', `Failed to retrieve yarn issue data: ${error.message}`);
      }
    }
  } catch (error) {
    console.error('Error in getYarnIssue:', error);
    return generateHTMLResponse('Error', `Failed to retrieve yarn issue records: ${error.message}`);
  }
};

/**
 * Get articles by order number
 * @param {Object} params - Parameters
 * @returns {Promise<string>} HTML string with articles
 */
export const getArticlesByOrder = async (params = {}) => {
  try {
    const { orderNumber } = params;
    
    if (!orderNumber) {
      return generateHTMLResponse('Order Number Required', 'Please provide an order number to search for articles.');
    }
    
    // Find the production order by order number
    const order = await ProductionOrder.findOne({ orderNumber: orderNumber.toUpperCase() }).lean();
    
    if (!order) {
      return generateHTMLResponse('Order Not Found', `No production order found with order number: ${orderNumber}`);
    }
    
    // Get all articles for this order
    const articles = await Article.find({ orderId: order._id })
      .populate('machineId', 'machineCode machineNumber model')
      .sort({ articleNumber: 1 })
      .lean();
    
    if (articles.length === 0) {
      return generateHTMLResponse('No Articles Found', `No articles found for order ${orderNumber}.`);
    }
    
    // Helper function to determine current floor from floorQuantities
    const getCurrentFloor = (article) => {
      if (!article.floorQuantities) return 'N/A';
      
      // Check floors in reverse order (warehouse -> knitting) to find the last floor with work
      const floors = ['warehouse', 'branding', 'finalChecking', 'boarding', 'washing', 'checking', 'linking', 'knitting'];
      for (const floor of floors) {
        const floorData = article.floorQuantities[floor];
        if (floorData && (floorData.completed > 0 || floorData.remaining > 0)) {
          // Convert floor key to display name
          const floorNames = {
            'knitting': 'Knitting',
            'linking': 'Linking',
            'checking': 'Checking',
            'washing': 'Washing',
            'boarding': 'Boarding',
            'finalChecking': 'Final Checking',
            'branding': 'Branding',
            'warehouse': 'Warehouse'
          };
          return floorNames[floor] || floor;
        }
      }
      return 'Knitting'; // Default to first floor
    };
    
    const totalPlannedQty = articles.reduce((sum, art) => sum + (art.plannedQuantity || 0), 0);
    const totalCompletedQty = articles.reduce((sum, art) => sum + (art.completedQuantity || 0), 0);
    const completionRate = totalPlannedQty > 0 ? Math.round((totalCompletedQty / totalPlannedQty) * 100) : 0;
    
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>📋 Articles for Order ${orderNumber}</h3>
        
        <div class="kpi-grid">
          <div class="kpi-item">
            <div class="kpi-label">Total Articles</div>
            <div class="kpi-value">${articles.length}</div>
            <div class="kpi-change">Items</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Planned Quantity</div>
            <div class="kpi-value">${totalPlannedQty.toLocaleString()}</div>
            <div class="kpi-change">Units</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Completed Quantity</div>
            <div class="kpi-value">${totalCompletedQty.toLocaleString()}</div>
            <div class="kpi-change">Units</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Completion Rate</div>
            <div class="kpi-value">${completionRate}%</div>
            <div class="kpi-change">Progress</div>
          </div>
        </div>
        
        <div class="chart-container">
          <h4>📋 Article List</h4>
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Article Number</th>
                  <th>Status</th>
                  <th>Current Floor</th>
                  <th>Planned Qty</th>
                  <th>Completed Qty</th>
                  <th>Progress</th>
                  <th>Priority</th>
                  <th>Linking Type</th>
                  <th>Machine</th>
                </tr>
              </thead>
              <tbody>
                ${articles.map((art) => {
                  const currentFloor = getCurrentFloor(art);
                  return `
                  <tr>
                    <td><strong>${art.articleNumber || 'N/A'}</strong></td>
                    <td><span style="background: ${art.status === 'Completed' ? '#d4edda' : art.status === 'In Progress' ? '#d1ecf1' : '#fff3cd'}; padding: 4px 8px; border-radius: 4px; font-weight: 500;">${art.status || 'N/A'}</span></td>
                    <td>${currentFloor}</td>
                    <td>${(art.plannedQuantity || 0).toLocaleString()}</td>
                    <td>${(art.completedQuantity || 0).toLocaleString()}</td>
                    <td>${(art.progress || 0)}%</td>
                    <td>${art.priority || 'N/A'}</td>
                    <td>${art.linkingType || 'N/A'}</td>
                    <td>${art.machineId ? (art.machineId.machineCode || art.machineId.machineNumber || 'N/A') : 'N/A'}</td>
                  </tr>
                `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
        
        <p class="summary">Found ${articles.length} articles for order ${orderNumber}. Total planned quantity: ${totalPlannedQty.toLocaleString()} units, completed: ${totalCompletedQty.toLocaleString()} units (${completionRate}% completion rate).</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getArticlesByOrder:', error);
    return generateHTMLResponse('Error', `Failed to retrieve articles: ${error.message}`);
  }
};

/**
 * Get article by ID or article number
 * @param {Object} params - Parameters
 * @returns {Promise<string>} HTML string with article details
 */
export const getArticleById = async (params = {}) => {
  try {
    const { articleId } = params;
    
    if (!articleId) {
      return generateHTMLResponse('Article ID Required', 'Please provide an article ID or article number to search.');
    }
    
    // Search by article ID (MongoDB _id) or article number
    let article = await Article.findOne({ id: articleId }).lean();
    
    if (!article) {
      // Try searching by articleNumber
      article = await Article.findOne({ articleNumber: articleId.toUpperCase() }).lean();
    }
    
    if (!article) {
      return generateHTMLResponse('Article Not Found', `No article found with ID or number: ${articleId}`);
    }
    
    // Get the order for this article
    const order = await ProductionOrder.findById(article.orderId).lean();
    
    // Helper function to determine current floor from floorQuantities
    const getCurrentFloor = (art) => {
      if (!art.floorQuantities) return 'N/A';
      const floors = ['warehouse', 'branding', 'finalChecking', 'boarding', 'washing', 'checking', 'linking', 'knitting'];
      for (const floor of floors) {
        const floorData = art.floorQuantities[floor];
        if (floorData && (floorData.completed > 0 || floorData.remaining > 0)) {
          const floorNames = {
            'knitting': 'Knitting', 'linking': 'Linking', 'checking': 'Checking',
            'washing': 'Washing', 'boarding': 'Boarding', 'finalChecking': 'Final Checking',
            'branding': 'Branding', 'warehouse': 'Warehouse'
          };
          return floorNames[floor] || floor;
        }
      }
      return 'Knitting';
    };
    
    const currentFloor = getCurrentFloor(article);
    const completionRate = article.plannedQuantity > 0 
      ? Math.round((article.completedQuantity / article.plannedQuantity) * 100) 
      : 0;
    
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>📋 Article Details</h3>
        
        <div class="kpi-grid">
          <div class="kpi-item">
            <div class="kpi-label">Article Number</div>
            <div class="kpi-value">${article.articleNumber || 'N/A'}</div>
            <div class="kpi-change">ID: ${article.id || 'N/A'}</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Order Number</div>
            <div class="kpi-value">${order?.orderNumber || 'N/A'}</div>
            <div class="kpi-change">Order</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Status</div>
            <div class="kpi-value">${article.status || 'N/A'}</div>
            <div class="kpi-change">Current</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Progress</div>
            <div class="kpi-value">${completionRate}%</div>
            <div class="kpi-change">Complete</div>
          </div>
        </div>
        
        <div class="chart-container">
          <h4>📋 Article Information</h4>
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Property</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Article Number</strong></td>
                  <td>${article.articleNumber || 'N/A'}</td>
                </tr>
                <tr>
                  <td><strong>Article ID</strong></td>
                  <td><code>${article.id || 'N/A'}</code></td>
                </tr>
                <tr>
                  <td><strong>Order Number</strong></td>
                  <td>${order?.orderNumber || 'N/A'}</td>
                </tr>
                <tr>
                  <td><strong>Status</strong></td>
                  <td><span style="background: ${article.status === 'Completed' ? '#d4edda' : article.status === 'In Progress' ? '#d1ecf1' : '#fff3cd'}; padding: 4px 8px; border-radius: 4px; font-weight: 500;">${article.status || 'N/A'}</span></td>
                </tr>
                <tr>
                  <td><strong>Current Floor</strong></td>
                  <td>${currentFloor}</td>
                </tr>
                <tr>
                  <td><strong>Planned Quantity</strong></td>
                  <td>${(article.plannedQuantity || 0).toLocaleString()}</td>
                </tr>
                <tr>
                  <td><strong>Completed Quantity</strong></td>
                  <td>${(article.completedQuantity || 0).toLocaleString()}</td>
                </tr>
                <tr>
                  <td><strong>Progress</strong></td>
                  <td>${(article.progress || 0)}%</td>
                </tr>
                <tr>
                  <td><strong>Priority</strong></td>
                  <td>${article.priority || 'N/A'}</td>
                </tr>
                <tr>
                  <td><strong>Linking Type</strong></td>
                  <td>${article.linkingType || 'N/A'}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        
        <p class="summary">Found article ${article.articleNumber || article.id} for order ${order?.orderNumber || 'N/A'}. Planned: ${(article.plannedQuantity || 0).toLocaleString()} units, Completed: ${(article.completedQuantity || 0).toLocaleString()} units (${completionRate}% completion).</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getArticleById:', error);
    return generateHTMLResponse('Error', `Failed to retrieve article: ${error.message}`);
  }
};

/**
 * Get yarn return records including pending returns
 * @param {Object} params - Parameters
 * @returns {Promise<string>} HTML string with yarn return records
 */
export const getYarnReturn = async (params = {}) => {
  try {
    const { limit = 50 } = params;
    
    console.log(`[getYarnReturn] Fetching yarn return data`);
    
    // Get all production orders
    const productionOrders = await ProductionOrder.find({})
      .select('orderNumber currentFloor status updatedAt createdAt')
      .sort({ updatedAt: -1 })
      .lean();
    console.log(`[getYarnReturn] Found ${productionOrders.length} production orders`);
    
    // Get all issued transactions
    const allIssuedTransactions = await yarnTransactionService.getAllYarnIssued({});
    console.log(`[getYarnReturn] Found ${Array.isArray(allIssuedTransactions) ? allIssuedTransactions.length : 0} issued transactions`);
    
    // Get all returned transactions
    const filters = { transaction_type: 'yarn_returned' };
    const allReturnedTransactions = await yarnTransactionService.queryYarnTransactions(filters);
    const returnedTransactions = Array.isArray(allReturnedTransactions) ? allReturnedTransactions : [];
    console.log(`[getYarnReturn] Found ${returnedTransactions.length} returned transactions`);
    
    // Process each order to calculate pending returns (matching frontend logic)
    const pendingReturns = [];
    const completedReturns = [];
    const matchedReturnTxIds = new Set(); // Track which return transactions were matched
    
    for (const order of productionOrders) {
      // Get issued transactions for this order
      const issuedForOrder = allIssuedTransactions.filter(t => t.orderno === order.orderNumber);
      
      if (issuedForOrder.length === 0) {
        continue; // Skip orders with no issued yarn
      }
      
      // Create virtual cones from issued transactions (matching frontend logic)
      const conesMap = new Map();
      const usedReturnedTxIds = new Set(); // Track which returned transactions have been matched
      
      issuedForOrder.forEach((tx) => {
        const numberOfCones = tx.transactionConeCount || 1;
        const coneBarcode = tx.coneBarcode || tx.barcode || `TX-${tx._id || tx.id}`;
        
        // Find matching returned transaction - match one-to-one where possible
        // Match by order number, yarn name, and ensure we don't double-match
        let returnedTx = returnedTransactions.find((rt) => {
          // Skip if this returned transaction was already matched
          if (usedReturnedTxIds.has(rt._id || rt.id)) {
            return false;
          }
          // Must match order number (case-insensitive, normalize)
          const rtOrderNo = (rt.orderno || '').trim().toUpperCase();
          const orderNo = order.orderNumber.trim().toUpperCase();
          if (rtOrderNo !== orderNo) {
            return false;
          }
          // Match by yarn name (case-insensitive, trim whitespace)
          const rtYarnName = (rt.yarnName || '').trim().toLowerCase();
          const txYarnName = (tx.yarnName || '').trim().toLowerCase();
          if (rtYarnName === txYarnName && rtYarnName !== '') {
            return true;
          }
          return false;
        });
        
        // If found a match, mark it as used
        if (returnedTx) {
          usedReturnedTxIds.add(returnedTx._id || returnedTx.id);
          matchedReturnTxIds.add(returnedTx._id || returnedTx.id); // Track globally
        }
        
        // Create cones based on transactionConeCount
        // Each cone is marked as returned only if there's a matching returned transaction
        // AND the returned transaction has enough cones to cover this issued transaction
        const returnedConeCount = returnedTx ? (returnedTx.transactionConeCount || 0) : 0;
        const conesToMarkAsReturned = Math.min(numberOfCones, returnedConeCount);
        
        for (let i = 0; i < numberOfCones; i++) {
          const uniqueId = numberOfCones > 1 ? `${coneBarcode}-${i}` : coneBarcode;
          // Mark cone as returned only if there's a matching returned transaction
          // and this cone index is within the returned count
          conesMap.set(uniqueId, {
            id: uniqueId,
            status: (returnedTx && i < conesToMarkAsReturned) ? 'Returned' : 'Awaiting',
            transactionId: tx._id || tx.id
          });
        }
      });
      
      const cones = Array.from(conesMap.values());
      const returnedCones = cones.filter(c => c.status === 'Returned').length;
      const pendingCones = cones.length - returnedCones;
      
      // Determine status based on returned cones (matching frontend logic)
      let status = 'Awaiting';
      if (cones.length === 0) {
        status = 'Awaiting';
      } else if (returnedCones === cones.length) {
        status = 'Returned';
      } else if (returnedCones > 0) {
        status = 'Partial';
      } else {
        status = 'Awaiting';
      }
      
      // Find the latest issued transaction date as knitting completed date
      const latestIssued = issuedForOrder.sort((a, b) => new Date(b.transactionDate) - new Date(a.transactionDate))[0];
      
      if (status === 'Returned') {
        // Order is fully returned - add to completed returns
        completedReturns.push({
          orderNumber: order.orderNumber,
          floor: order.currentFloor || 'N/A',
          knittingCompletedAt: latestIssued?.transactionDate || order.updatedAt || order.createdAt,
          returnedCones: returnedCones,
          pendingCones: 0,
          totalCones: cones.length,
          status: status,
          lastUpdated: order.updatedAt || order.createdAt
        });
      } else if (pendingCones > 0) {
        // Order has pending returns
        pendingReturns.push({
          orderNumber: order.orderNumber,
          floor: order.currentFloor || 'N/A',
          knittingCompletedAt: latestIssued?.transactionDate || order.updatedAt || order.createdAt,
          returnedCones: returnedCones,
          pendingCones: pendingCones,
          totalCones: cones.length,
          status: status,
          lastUpdated: order.updatedAt || order.createdAt
        });
      }
    }
    
    // Sort pending returns by order number (ascending: ORD-000001, ORD-000002, etc.)
    pendingReturns.sort((a, b) => {
      const orderA = a.orderNumber || '';
      const orderB = b.orderNumber || '';
      return orderA.localeCompare(orderB, undefined, { numeric: true, sensitivity: 'base' });
    });
    
    // Sort completed returns by order number (ascending)
    completedReturns.sort((a, b) => {
      const orderA = a.orderNumber || '';
      const orderB = b.orderNumber || '';
      return orderA.localeCompare(orderB, undefined, { numeric: true, sensitivity: 'base' });
    });
    
    // Only show return transactions that were matched to orders
    const matchedReturnTransactions = returnedTransactions.filter(rt => 
      matchedReturnTxIds.has(rt._id || rt.id)
    );
    const limitedCompletedReturns = matchedReturnTransactions.slice(0, parseInt(limit) || 50);
    
    const totalPendingOrders = pendingReturns.length;
    const totalPendingCones = pendingReturns.reduce((sum, order) => sum + order.pendingCones, 0);
    const totalClearedOrders = completedReturns.length;
    const totalCompletedReturns = matchedReturnTransactions.length;
    const totalCompletedNetWeight = matchedReturnTransactions.reduce((sum, txn) => sum + (txn.transactionNetWeight || 0), 0);
    const totalCompletedCones = matchedReturnTransactions.reduce((sum, txn) => sum + (txn.transactionConeCount || 0), 0);
    
    const limitedPendingReturns = pendingReturns.slice(0, parseInt(limit) || 50);
    
    // Build HTML response
    let html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>📥 Yarn Return</h3>
        
        <div class="kpi-grid">
          <div class="kpi-item">
            <div class="kpi-label">Orders Awaiting Return</div>
            <div class="kpi-value">${totalPendingOrders}</div>
            <div class="kpi-change">Orders</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Cones Pending Return</div>
            <div class="kpi-value">${totalPendingCones}</div>
            <div class="kpi-change">Cones</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Orders Cleared</div>
            <div class="kpi-value">${totalClearedOrders}</div>
            <div class="kpi-change">Orders</div>
          </div>
        </div>`;
    
    // Add pending returns section
    if (limitedPendingReturns.length > 0) {
      html += `
        <div class="chart-container">
          <h4>📋 Pending Cone Returns (${totalPendingOrders})</h4>
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Production Order</th>
                  <th>Floor</th>
                  <th>Knitting Completed</th>
                  <th>Returned Cones</th>
                  <th>Pending Cones</th>
                  <th>Status</th>
                  <th>Last Updated</th>
                </tr>
              </thead>
              <tbody>
                ${limitedPendingReturns.map((order) => `
                  <tr>
                    <td><strong>${order.orderNumber}</strong></td>
                    <td>${order.floor}</td>
                    <td>${order.knittingCompletedAt ? new Date(order.knittingCompletedAt).toLocaleString() : 'N/A'}</td>
                    <td>${order.returnedCones}</td>
                    <td>${order.pendingCones}</td>
                    <td><span style="background: ${order.status === 'Awaiting' ? '#fff3cd' : order.status === 'Partial' ? '#d1ecf1' : '#d4edda'}; padding: 4px 8px; border-radius: 4px; font-weight: 500;">${order.status}</span></td>
                    <td>${order.lastUpdated ? new Date(order.lastUpdated).toLocaleString() : 'N/A'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>`;
    }
    
    // Add completed returns section (only if there are actual return transactions)
    if (limitedCompletedReturns.length > 0 && totalCompletedReturns > 0) {
      html += `
        <div class="chart-container" style="margin-top: 30px;">
          <h4>📋 Completed Return Transaction Records</h4>
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Return Date</th>
                  <th>Yarn Name</th>
                  <th>Order No</th>
                  <th>Net Weight (kg)</th>
                  <th>Total Weight (kg)</th>
                  <th>Cones</th>
                </tr>
              </thead>
              <tbody>
                ${limitedCompletedReturns.map((txn) => `
                  <tr>
                    <td>${txn.transactionDate ? new Date(txn.transactionDate).toLocaleDateString() : 'N/A'}</td>
                    <td>${txn.yarnName || txn.yarn?.yarnName || 'N/A'}</td>
                    <td><strong>${txn.orderno || 'N/A'}</strong></td>
                    <td>${(txn.transactionNetWeight || 0).toLocaleString()}</td>
                    <td>${(txn.transactionTotalWeight || 0).toLocaleString()}</td>
                    <td>${(txn.transactionConeCount || 0).toLocaleString()}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>`;
    }
    
    html += `
        <p class="summary">Found ${totalPendingOrders} orders awaiting cone return with ${totalPendingCones} pending cones. ${totalClearedOrders > 0 ? `${totalClearedOrders} orders have been fully returned (status: Returned). ` : ''}${totalCompletedReturns > 0 ? `Completed return transactions: ${totalCompletedReturns} records.` : 'No completed return transaction records found.'}</p>
      </div>
    `;
    
    // Only return error if there's truly no data at all
    if (totalPendingOrders === 0 && totalCompletedReturns === 0 && totalClearedOrders === 0) {
      console.log(`[getYarnReturn] No data found: pendingOrders=${totalPendingOrders}, completedReturns=${totalCompletedReturns}, clearedOrders=${totalClearedOrders}`);
      return generateHTMLResponse('No Yarn Return Records Found', 'No yarn return records found in the system.');
    }
    
    console.log(`[getYarnReturn] Returning HTML with ${totalPendingOrders} pending orders and ${totalCompletedReturns} completed returns`);
    return html;
  } catch (error) {
    console.error('Error in getYarnReturn:', error);
    return generateHTMLResponse('Error', `Failed to retrieve yarn return records: ${error.message}`);
  }
};

/**
 * Get yarn purchase orders
 * @param {Object} params - Parameters with optional status
 * @returns {Promise<string>} HTML string with purchase orders
 */
export const getYarnPurchaseOrders = async (params = {}) => {
  try {
    const { status, limit = 50 } = params;
    
    // Set default date range (last 1 year if not specified to get all recent purchase orders)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 1); // Default to last 1 year to get all purchase orders
    
    // Ensure dates are valid before passing
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new Error('Failed to create valid date range');
    }
    
    let queryParams = {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString()
    };
    
    if (status) {
      queryParams.statusCode = status;
    }
    
    console.log(`[getYarnPurchaseOrders] Fetching purchase orders with params:`, queryParams);
    const purchaseOrders = await yarnPurchaseOrderService.getPurchaseOrders(queryParams);
    console.log(`[getYarnPurchaseOrders] Received ${Array.isArray(purchaseOrders) ? purchaseOrders.length : 0} purchase orders`);
    
    const orders = Array.isArray(purchaseOrders) ? purchaseOrders : [];
    const limitedOrders = orders.slice(0, parseInt(limit) || 50);
    
    if (orders.length === 0) {
      console.log(`[getYarnPurchaseOrders] No purchase orders found, returning empty message`);
      return generateHTMLResponse('No Purchase Orders Found', 'No yarn purchase orders found.');
    }
    
    console.log(`[getYarnPurchaseOrders] Processing ${limitedOrders.length} orders for display`);
    
    const totalCount = orders.length;
    const statusCounts = {};
    orders.forEach(po => {
      const poStatus = po.currentStatus || po.status || 'Unknown';
      statusCounts[poStatus] = (statusCounts[poStatus] || 0) + 1;
    });
    
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>🛒 Yarn Purchase Orders${status ? ` - ${status}` : ''}</h3>
        
        <div class="kpi-grid">
          <div class="kpi-item">
            <div class="kpi-label">Total Purchase Orders</div>
            <div class="kpi-value">${totalCount.toLocaleString()}</div>
            <div class="kpi-change">In System</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Status Types</div>
            <div class="kpi-value">${Object.keys(statusCounts).length}</div>
            <div class="kpi-change">Unique Statuses</div>
          </div>
        </div>
        
        <div class="chart-container">
          <h4>📋 Purchase Orders List</h4>
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>PO Number</th>
                  <th>Create Date</th>
                  <th>Supplier</th>
                  <th>Total Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${limitedOrders.map((po) => {
                  const supplierName = po.supplier?.brandName || (typeof po.supplier === 'string' ? po.supplier : 'N/A');
                  const status = po.currentStatus || po.status || 'N/A';
                  return `
                  <tr>
                    <td>${po.poNumber || 'N/A'}</td>
                    <td>${po.createDate ? new Date(po.createDate).toLocaleDateString() : 'N/A'}</td>
                    <td>${supplierName}</td>
                    <td>₹${(po.totalAmount || 0).toLocaleString()}</td>
                    <td><span style="background: ${status === 'goods_received' ? '#d4edda' : status === 'in_transit' ? '#d1ecf1' : '#fff3cd'}; padding: 4px 8px; border-radius: 4px; font-weight: 500;">${status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</span></td>
                  </tr>
                `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
        
        <p class="summary">Found ${totalCount.toLocaleString()} purchase orders${totalCount > limitedOrders.length ? ` (showing ${limitedOrders.length} of ${totalCount})` : ''}.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getYarnPurchaseOrders:', error);
    return generateHTMLResponse('Error', `Failed to retrieve purchase orders: ${error.message}`);
  }
};

/**
 * Resolve purchase order id from poNumber or return id if already valid
 * @param {string} purchaseOrderIdOrPoNumber - Mongo Id or PO number
 * @returns {Promise<string|null>} Mongo Id
 */
const resolvePurchaseOrderId = async (purchaseOrderIdOrPoNumber) => {
  if (!purchaseOrderIdOrPoNumber || typeof purchaseOrderIdOrPoNumber !== 'string') return null;
  const val = purchaseOrderIdOrPoNumber.trim();
  const ObjectId = (await import('mongoose')).default.Types.ObjectId;
  if (ObjectId.isValid(val) && String(new ObjectId(val)) === val) {
    return val;
  }
  const order = await yarnPurchaseOrderService.getPurchaseOrderByPoNumber(val);
  return order ? order._id?.toString() : null;
};

/**
 * Get single yarn purchase order by ID or PO number (for agent)
 * @param {Object} params - { purchaseOrderId, poNumber }
 * @returns {Promise<string>} HTML
 */
export const getYarnPurchaseOrderById = async (params = {}) => {
  try {
    const p = params && typeof params === 'object' ? params : {};
    const id = p.purchaseOrderId || p.poNumber || p.orderId;
    if (!id) {
      return generateHTMLResponse('Purchase Order Details', 'Please specify a purchase order ID or PO number (e.g. "order details PO-2024-001" or "order by id &lt;id&gt;").');
    }
    let order = null;
    const objectId = (await import('mongoose')).default.Types.ObjectId;
    if (objectId.isValid(id) && String(new objectId(id)) === id) {
      order = await yarnPurchaseOrderService.getPurchaseOrderById(id);
    } else {
      order = await yarnPurchaseOrderService.getPurchaseOrderByPoNumber(id);
    }
    if (!order) {
      return generateHTMLResponse('Purchase Order Not Found', `No purchase order found for "${id}".`);
    }
    return buildOrderDetailsHtml(order);
  } catch (error) {
    console.error('Error in getYarnPurchaseOrderById:', error);
    return generateHTMLResponse('Error', `Failed to get purchase order: ${error.message}`);
  }
};

const PAGE_SIZE = 5;

/** Build order summary HTML from placeOrderContext.collectedItems (for confirmation before placing) */
const buildPlaceOrderSummaryHtml = (ctx) => {
  const items = ctx.collectedItems || [];
  let subTotal = 0;
  let gstTotal = 0;
  const rows = items.map((it) => {
    const lineTotal = it.rate * it.quantity;
    const lineGst = (it.gstRate || 0) ? (lineTotal * it.gstRate) / 100 : 0;
    subTotal += lineTotal;
    gstTotal += lineGst;
    return `<tr><td>${it.yarnName}</td><td>₹${Number(it.rate).toLocaleString()}</td><td>${it.quantity}</td><td>${it.gstRate ?? 0}%</td><td>₹${(lineTotal + lineGst).toLocaleString()}</td></tr>`;
  }).join('');
  const total = subTotal + gstTotal;
  return AI_TOOL_STYLES + `
    <div class="ai-tool-response">
      <h3>📋 Order Summary — ${ctx.supplierName || 'Supplier'}</h3>
      <p class="summary" style="margin: 0.4em 0;"><strong>Supplier:</strong> ${ctx.supplierName || 'N/A'}</p>
      <div class="table-container">
        <table class="data-table">
          <thead><tr><th>Yarn</th><th>Rate (₹)</th><th>Qty</th><th>GST %</th><th>Line Total</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="summary" style="margin: 0.6em 0;"><strong>Subtotal:</strong> ₹${subTotal.toLocaleString()} &nbsp;|&nbsp; <strong>GST:</strong> ₹${gstTotal.toLocaleString()} &nbsp;|&nbsp; <strong>Total:</strong> ₹${total.toLocaleString()}</p>
      <p class="summary" style="margin-top: 0.8em;"><strong>Do you want to place this order?</strong> Type <strong>yes</strong> to confirm or <strong>no</strong> to cancel.</p>
    </div>`;
};

/**
 * Resolve a yarn name (e.g. from supplier list) to a catalog entry. Tries full name, then prefix matches.
 * @param {string} yarnName - e.g. "20s-Beige-Bamboo/Bamboo"
 * @returns {Promise<Object|null>} catalog doc or null
 */
const findYarnCatalogForPlaceOrder = async (yarnName) => {
  if (!yarnName || !String(yarnName).trim()) return null;
  const name = String(yarnName).trim();
  let res = await yarnCatalogService.queryYarnCatalogs({ yarnName: name }, { limit: 1 });
  let catalog = res?.results?.[0] || res?.[0] || null;
  if (catalog) return catalog;
  const parts = name.split('-').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const prefix = parts.slice(0, 2).join('-');
    res = await yarnCatalogService.queryYarnCatalogs({ yarnName: prefix }, { limit: 10 });
    const list = res?.results ?? res ?? [];
    const lower = name.toLowerCase();
    catalog = list.find((c) => (c.yarnName || '').toLowerCase() === lower) ||
      list.find((c) => (c.yarnName || '').toLowerCase().includes(lower)) ||
      list.find((c) => lower.includes((c.yarnName || '').toLowerCase())) ||
      list[0];
  }
  if (!catalog && parts.length >= 1) {
    res = await yarnCatalogService.queryYarnCatalogs({ yarnName: parts[0] }, { limit: 20 });
    const list = res?.results ?? res ?? [];
    const lower = name.toLowerCase();
    catalog = list.find((c) => (c.yarnName || '').toLowerCase().includes(lower)) || list[0];
  }
  return catalog || null;
};

/** Create PO from placeOrderContext (used after user confirms "yes") */
export const createPurchaseOrderFromPlaceContext = async (placeOrderContext) => {
  const ctx = placeOrderContext || {};
  const nextPoNumber = await yarnPurchaseOrderService.getNextSuggestedPoNumber();
  const supplier = await supplierService.getSupplierById(ctx.supplierId);
  if (!supplier) throw new Error('Supplier not found.');
  const poItems = [];
  let subTotal = 0;
  let gstTotal = 0;
  for (const it of ctx.collectedItems || []) {
    const yarnCatalog = await findYarnCatalogForPlaceOrder(it.yarnName);
    if (!yarnCatalog) throw new Error(`Yarn "${it.yarnName}" not found in catalog. Add the yarn to the catalog first, or use a name that matches an existing catalog entry.`);
    const yarnId = yarnCatalog._id?.toString?.() || yarnCatalog.id;
    const fullYarnName = yarnCatalog.yarnName || it.yarnName || '';
    // sizeCount is the start of product name (e.g. "20/40" from "20/40-Black-Black-Nylon/Spandex")
    const sizeCount = (fullYarnName.split('-')[0] || '').trim() || (it.sizeCount || 'N/A');
    const shadeCode = it.shadeCode || (fullYarnName.split('-').length > 1 ? fullYarnName.split('-')[1]?.trim() : undefined);
    const lineTotal = it.rate * it.quantity;
    const lineGst = (it.gstRate || 0) ? (lineTotal * it.gstRate) / 100 : 0;
    subTotal += lineTotal;
    gstTotal += lineGst;
    poItems.push({
      yarn: yarnId,
      yarnName: fullYarnName,
      sizeCount,
      shadeCode: shadeCode || undefined,
      rate: it.rate,
      quantity: it.quantity,
      gstRate: it.gstRate || undefined
    });
  }
  const total = subTotal + gstTotal;
  const body = {
    poNumber: nextPoNumber,
    supplierName: ctx.supplierName,
    supplier: ctx.supplierId,
    poItems,
    subTotal,
    gst: gstTotal,
    total,
    currentStatus: 'submitted_to_supplier'
  };
  const created = await yarnPurchaseOrderService.createPurchaseOrder(body);
  return { created, total, poItems };
};

/**
 * Handle place-order chat flow: load more, pick yarn (by number/name/keyword), then quantity → rate → gst one by one, then done → summary + confirm.
 * @param {Object} ctx - placeOrderContext: { supplierId, supplierName, yarnNames, page, yarnDisambiguationList?, collectingYarnName?, collectingStep?, collectedItems? }
 * @param {string} userMessage
 * @returns {Promise<{ html: string, orderWizardPrompt?: string, placeOrderContext?: Object, needsPlaceOrderConfirmation?: boolean, summary?: string }>}
 */
export const handlePlaceOrderYarnChat = async (ctx, userMessage) => {
  const msg = (userMessage || '').trim().toLowerCase();
  const ctxCopy = { ...ctx, yarnNames: ctx.yarnNames || [], collectedItems: ctx.collectedItems || [] };

  if (/^(cancel|start\s+over|never\s+mind|forget\s+it)$/i.test(msg) || msg === 'no') {
    const html = generateHTMLResponse('Order cancelled', 'Order cancelled. Say <strong>place order</strong> to start a new one.');
    return { html, orderWizardPrompt: null, placeOrderContext: undefined, summary: 'Order cancelled.' };
  }

  // "yes"/"y"/"confirm" when we have order summary (collectedItems) — place the order (handles both inPlaceOrderYarnFlow and stored create_po path)
  const hasCollectedItems = (ctx.collectedItems?.length ?? 0) > 0;
  if (hasCollectedItems && /^(?:yes|y|confirm)\s*$/i.test(msg)) {
    try {
      const { created, total, poItems } = await createPurchaseOrderFromPlaceContext(ctx);
      const html = generateHTMLResponse('Order Placed', `Purchase order <strong>${created.poNumber}</strong> created successfully with ${poItems.length} item(s). Total: ₹${total.toLocaleString()}. Opening the form so you can see it.`);
      return { html, orderWizardPrompt: null, placeOrderContext: undefined, summary: `Order placed with PO number ${created.poNumber}.` };
    } catch (err) {
      const html = generateHTMLResponse('Error', err?.message || 'Failed to place order.');
      return { html, orderWizardPrompt: null, placeOrderContext: ctxCopy, summary: 'Place order failed.' };
    }
  }

  // "but" = common typo for "buy" (e.g. "wanna but yarn", "i want to but yarn")
  const isBuyIntent = /\b(wanna|want\s+to|would\s+like\s+to|i\s+want\s+to)\s+(buy|but|purchase|order|get)\s+(some\s+)?yarn\b/i.test(msg) ||
    /\b(buy|but|purchase|order)\s+(some\s+)?yarn\b/i.test(msg) ||
    /^hey\s*,?\s*(i\s+)?(wanna|want\s+to)\s+(buy|but|purchase)/i.test(msg);
  if (isBuyIntent) {
    const yarnNames = ctx.yarnNames || [];
    const page = ctx.page || 1;
    const start = (page - 1) * PAGE_SIZE;
    const slice = yarnNames.slice(start, start + PAGE_SIZE);
    const hasMore = start + PAGE_SIZE < yarnNames.length;
    const listHtml = slice.map((y, i) => `${start + i + 1}. ${y}`).join('<br/>');
    const html = generateHTMLResponse(
      'Already placing an order',
      `<p>You're already placing an order with <strong>${ctx.supplierName || 'your supplier'}</strong>.</p><p class="summary" style="margin: 0.6em 0; padding-left: 1em; line-height: 1.6;">${listHtml ? `Here are yarn items (page ${page}):<br/>${listHtml}` : 'No yarn list loaded.'}</p>${hasMore ? `<p class="summary">Reply with <strong>load more</strong> for more.</p>` : ''}<p class="summary" style="margin-top: 0.6em;">Pick a yarn by <strong>number</strong> or <strong>name</strong> (e.g. black, light blue), or say <strong>done</strong> when you're finished.</p><p class="summary">To start a new order instead, say <strong>cancel</strong>.</p>`
    );
    return { html, orderWizardPrompt: 'choose_yarn_from_supplier', placeOrderContext: ctxCopy, summary: 'Pick a yarn from the list or say done.' };
  }

  if (msg === 'load more') {
    const page = (ctx.page || 1) + 1;
    const start = (page - 1) * PAGE_SIZE;
    const slice = (ctx.yarnNames || []).slice(start, start + PAGE_SIZE);
    const hasMore = start + PAGE_SIZE < (ctx.yarnNames || []).length;
    const listHtml = slice.map((y, i) => `${start + i + 1}. ${y}`).join('<br/>');
    const html = generateHTMLResponse(
      'More yarns',
      `<p>Here are more yarn items from <strong>${ctx.supplierName}</strong> (page ${page}):</p><p class="summary" style="margin: 0.6em 0; padding-left: 1em; line-height: 1.6;">${listHtml || 'No more items.'}</p>${hasMore ? `<p class="summary">Reply with <strong>load more</strong> for more.</p>` : ''}<p class="summary" style="margin-top: 0.8em;">Reply with the <strong>number or name</strong> of the yarn to add, or <strong>done</strong> to create the order.</p>`
    );
    return { html, orderWizardPrompt: 'choose_yarn_from_supplier', placeOrderContext: { ...ctxCopy, page }, summary: 'More yarns. Pick one or say done.' };
  }

  // "I want to add more" / "add more" / "show list" etc. — show yarn list and ask to choose (don't treat as yarn search)
  const isAddMoreIntent = /^(?:i\s+)?(?:want\s+to\s+)?add\s+more\b|^add\s+more\b|^more\s+items?\b|^(?:add\s+)?another\s+(?:one|item)\b|^show\s+(?:me\s+)?(?:the\s+)?list\b|^show\s+list\b|^yes\s*,?\s*add\s+more\b|^sure\s*,?\s*(?:add\s+)?more\b/i.test(msg);
  if (isAddMoreIntent) {
    const yarnList = ctx.yarnNames || [];
    const page = ctx.page || 1;
    const start = (page - 1) * PAGE_SIZE;
    const slice = yarnList.slice(start, start + PAGE_SIZE);
    const hasMore = start + PAGE_SIZE < yarnList.length;
    const listHtml = slice.map((y, i) => `${start + i + 1}. ${y}`).join('<br/>');
    const html = generateHTMLResponse(
      'Choose yarn',
      `<p>Here are yarn items from <strong>${ctx.supplierName || 'your supplier'}</strong> (page ${page}):</p><p class="summary" style="margin: 0.6em 0; padding-left: 1em; line-height: 1.6;">${listHtml || 'No yarn list loaded.'}</p>${hasMore ? `<p class="summary">Reply with <strong>load more</strong> for more options.</p>` : ''}<p class="summary" style="margin-top: 0.8em;">Reply with the <strong>number or name</strong> of the yarn to add, or <strong>done</strong> to create the order.</p>`
    );
    return { html, orderWizardPrompt: 'choose_yarn_from_supplier', placeOrderContext: ctxCopy, summary: 'Choose a yarn from the list or say done.' };
  }

  // "Change supplier to X" / "Change supplier to X and look for Y" — switch to new supplier (and optional colour), return new choose-yarn screen
  const changeSupplierMatch = (userMessage || '').trim().match(/change\s+supplier\s+to\s+(.+)/i);
  if (changeSupplierMatch) {
    let changePhrase = changeSupplierMatch[1].trim();
    let changeYarnHint = null;
    const andLookFor = changePhrase.match(/\s+and\s+look\s+for\s+(.+)$/i);
    if (andLookFor) {
      changeYarnHint = andLookFor[1].trim().replace(/\s*yarn\s*$/i, '').trim();
      changePhrase = changePhrase.replace(/\s+and\s+look\s+for\s+.+$/i, '').trim();
    }
    if (changePhrase.length >= 2 && changePhrase.length <= 80) {
      try {
        const changeResult = await createYarnPurchaseOrder({
          supplierQuery: changePhrase,
          yarnHint: changeYarnHint && changeYarnHint.length >= 2 ? changeYarnHint : undefined
        });
        if (changeResult && typeof changeResult === 'object' && changeResult.html) {
          return {
            html: changeResult.html,
            orderWizardPrompt: changeResult.orderWizardPrompt ?? 'choose_yarn_from_supplier',
            placeOrderContext: changeResult.placeOrderContext ?? null,
            summary: changeResult.placeOrderContext ? 'Switched supplier; choose yarn.' : 'Processing.'
          };
        }
      } catch (e) {
        console.warn('Change supplier failed:', e?.message);
      }
    }
  }

  if (ctx.yarnDisambiguationList && ctx.yarnDisambiguationList.length > 0) {
    const raw = String(userMessage).trim();
    let n = parseInt(raw, 10);
    if (Number.isNaN(n) || n < 1 || n > ctx.yarnDisambiguationList.length) {
      // Quick regex: "i want 3", "3 onw", "number 3", "option 2" -> first number in range
      const firstNum = raw.match(/\b([1-9]\d*)\b/);
      if (firstNum) {
        const num = parseInt(firstNum[1], 10);
        if (num >= 1 && num <= ctx.yarnDisambiguationList.length) n = num;
      }
      if (Number.isNaN(n) || n < 1 || n > ctx.yarnDisambiguationList.length) {
        // GPT: interpret "the third one", "3 onw" (typo), "i want the 3rd" as list index
        try {
          const interpreted = await interpretPlaceOrderChatMessage(raw, {
            yarnNames: ctx.yarnDisambiguationList,
            supplierName: ctx.supplierName,
            collectingStep: 'disambiguation',
            collectedItems: ctx.collectedItems
          });
          if (interpreted?.action === 'list_index' && typeof interpreted.value === 'number') {
            const idx = Math.floor(interpreted.value);
            if (idx >= 1 && idx <= ctx.yarnDisambiguationList.length) n = idx;
          }
        } catch (e) {
          // ignore
        }
      }
    }
    if (!Number.isNaN(n) && n >= 1 && n <= ctx.yarnDisambiguationList.length) {
      const chosenYarn = ctx.yarnDisambiguationList[n - 1];
      ctxCopy.collectingYarnName = chosenYarn;
      ctxCopy.collectingStep = 'quantity';
      ctxCopy.yarnDisambiguationList = undefined;
      const html = generateHTMLResponse('Quantity', `How much yarn do you need for <strong>${chosenYarn}</strong>?`);
      return { html, orderWizardPrompt: 'choose_yarn_from_supplier', placeOrderContext: ctxCopy, summary: 'Adding yarn. Enter quantity.' };
    }
    ctxCopy.yarnDisambiguationList = undefined;
  }

  if (ctx.collectingStep === 'quantity') {
    let qty = parseFloat(String(userMessage).trim().replace(/,/g, ''));
    if (Number.isNaN(qty) || qty <= 0) {
      const interpreted = await interpretPlaceOrderChatMessage(String(userMessage).trim(), { collectingStep: 'quantity', collectingYarnName: ctx.collectingYarnName, supplierName: ctx.supplierName });
      if (interpreted?.action === 'quantity' && typeof interpreted.value === 'number' && interpreted.value > 0) qty = interpreted.value;
    }
    if (Number.isNaN(qty) || qty <= 0) {
      return { html: generateHTMLResponse('Quantity', `Please enter a valid quantity (number) for <strong>${ctx.collectingYarnName}</strong>.`), orderWizardPrompt: 'choose_yarn_from_supplier', placeOrderContext: ctxCopy };
    }
    ctxCopy.collectingQuantity = qty;
    ctxCopy.collectingStep = 'rate';
    const html = generateHTMLResponse('Rate', `What <strong>rate</strong> do you want for <strong>${ctx.collectingYarnName}</strong>? (₹ per unit)`);
    return { html, orderWizardPrompt: 'choose_yarn_from_supplier', placeOrderContext: ctxCopy, summary: 'Enter rate.' };
  }

  if (ctx.collectingStep === 'rate') {
    let rate = parseFloat(String(userMessage).trim().replace(/,/g, '').replace(/[₹rs.]/gi, ''));
    if (Number.isNaN(rate) || rate <= 0) {
      const interpreted = await interpretPlaceOrderChatMessage(String(userMessage).trim(), { collectingStep: 'rate', collectingYarnName: ctx.collectingYarnName, supplierName: ctx.supplierName });
      if (interpreted?.action === 'rate' && typeof interpreted.value === 'number' && interpreted.value > 0) rate = interpreted.value;
    }
    if (Number.isNaN(rate) || rate <= 0) {
      return { html: generateHTMLResponse('Rate', `Please enter a valid rate (₹ per unit) for <strong>${ctx.collectingYarnName}</strong>.`), orderWizardPrompt: 'choose_yarn_from_supplier', placeOrderContext: ctxCopy };
    }
    ctxCopy.collectingRate = rate;
    ctxCopy.collectingStep = 'gst';
    const html = generateHTMLResponse('GST', `How much <strong>GST</strong> is there for <strong>${ctx.collectingYarnName}</strong>? (Enter percentage, e.g. 12 or 0)`);
    return { html, orderWizardPrompt: 'choose_yarn_from_supplier', placeOrderContext: ctxCopy, summary: 'Enter GST %.' };
  }

  if (ctx.collectingStep === 'gst') {
    const gstInput = String(userMessage).trim().replace(/%/g, '');
    const gstRate = Number.isNaN(parseFloat(gstInput)) ? 0 : Math.max(0, parseFloat(gstInput));
    const yarnNameAdded = ctx.collectingYarnName;
    ctxCopy.collectedItems.push({
      yarnName: ctx.collectingYarnName,
      quantity: ctx.collectingQuantity,
      rate: ctx.collectingRate,
      gstRate
    });
    ctxCopy.collectingYarnName = undefined;
    ctxCopy.collectingStep = undefined;
    ctxCopy.collectingQuantity = undefined;
    ctxCopy.collectingRate = undefined;
    const html = generateHTMLResponse('Item added', `Added <strong>${yarnNameAdded}</strong>. Add another yarn? Reply with the <strong>number or name</strong> from the list, or <strong>done</strong> to create the order.`);
    return { html, orderWizardPrompt: 'choose_yarn_from_supplier', placeOrderContext: ctxCopy, summary: 'Item added. Add more or say done.' };
  }

  if (msg === 'done' && (ctx.collectedItems || []).length > 0) {
    const html = buildPlaceOrderSummaryHtml(ctxCopy);
    return {
      html,
      orderWizardPrompt: null,
      placeOrderContext: ctxCopy,
      needsPlaceOrderConfirmation: true,
      summary: 'Review your order. Type yes to place or no to cancel.'
    };
  }

  if (msg === 'done') {
    return { html: generateHTMLResponse('Order', 'No items added yet. Reply with the number or name of a yarn to add, or start over with "place order".'), orderWizardPrompt: 'choose_yarn_from_supplier', placeOrderContext: ctxCopy };
  }

  const yarnNames = ctx.yarnNames || [];
  const rawInput = String(userMessage).trim();

  // Question-style request: "do you have anything in blue", "do they anything in black", "look for blue", "another colour black" — extract color/keyword
  const questionKeywordMatch = rawInput.match(/^(?:do\s+you\s+have\s+(?:anything\s+in\s+|something\s+in\s+)?|do\s+they\s+(?:have\s+)?(?:anything\s+in\s+|something\s+in\s+)|do\s+we\s+have\s+(?:anything\s+in\s+|something\s+in\s+)?|(?:is\s+there\s+)(?:anything\s+in\s+|something\s+in\s+)|(?:have\s+they\s+)(?:anything\s+in\s+|something\s+in\s+)|anything\s+in\s+|something\s+in\s+|any\s+|show\s+me\s+(?:some\s+)?|got\s+any\s+|what\s+about\s+in\s+|what\s+about\s+|look\s+for\s+|another\s+colou?r\s+)(.+)$/i)
    || rawInput.match(/\b(?:anything|something)\s+in\s+([a-zA-Z]+)\s*$/i);  // "... anything in black" at end (e.g. "do they anything in black")
  let questionKeyword = questionKeywordMatch && questionKeywordMatch[1] ? questionKeywordMatch[1].replace(/\s*yarn\s*$/i, '').trim() : null;
  if (questionKeyword && /^something\s+/i.test(questionKeyword)) questionKeyword = questionKeyword.replace(/^something\s+/i, '').trim();
  if (questionKeyword && /\b(?:anything|something)\s+in\s+/i.test(questionKeyword)) questionKeyword = questionKeyword.replace(/^(?:anything|something)\s+in\s+/i, '').trim();
  if (questionKeyword && questionKeyword.length >= 2) {
    let searchKeyword = questionKeyword;
    const availableTerms = extractTermsFromYarnNames(yarnNames);
    if (availableTerms.length > 0) {
      const corrected = await suggestYarnKeywordCorrection(questionKeyword, availableTerms);
      if (corrected && corrected.toLowerCase() !== questionKeyword.toLowerCase()) searchKeyword = corrected;
    }
    const kwLower = searchKeyword.toLowerCase();
    const matchesInList = yarnNames.filter((y) => y.toLowerCase().includes(kwLower));
    if (matchesInList.length === 1) {
      const chosenYarn = matchesInList[0];
      ctxCopy.collectingYarnName = chosenYarn;
      ctxCopy.collectingStep = 'quantity';
      const html = generateHTMLResponse('Quantity', `How much yarn do you need for <strong>${chosenYarn}</strong>?`);
      return { html, orderWizardPrompt: 'choose_yarn_from_supplier', placeOrderContext: ctxCopy, summary: 'Enter quantity.' };
    }
    if (matchesInList.length > 1) {
      ctxCopy.yarnDisambiguationList = matchesInList;
      const listHtml = matchesInList.map((y, i) => `${i + 1}. ${y}`).join('<br/>');
      const html = generateHTMLResponse('Yarns matching your search', `Here are yarns with "<strong>${searchKeyword}</strong>" in the name. Reply with the <strong>number</strong> (1–${matchesInList.length}):<p class="summary" style="margin: 0.6em 0; padding-left: 1em; line-height: 1.6;">${listHtml}</p>`);
      return { html, orderWizardPrompt: 'choose_yarn_from_supplier', placeOrderContext: ctxCopy, summary: 'Multiple yarns match; choose by number.' };
    }
    if (matchesInList.length === 0) {
      return { html: generateHTMLResponse('No match', `No yarn found with "<strong>${searchKeyword}</strong>" in the name. Try a different keyword or pick from the list by number.`), orderWizardPrompt: 'choose_yarn_from_supplier', placeOrderContext: ctxCopy, summary: 'No match. Try again.' };
    }
  }

  // Only treat as list index when message is exactly a number (e.g. "70") — not "70/2-Black..." which is a yarn name
  const num = parseInt(rawInput, 10);
  const isListIndex = /^\d+$/.test(rawInput) && !Number.isNaN(num) && num >= 1 && num <= yarnNames.length;
  let chosenYarn = null;
  if (isListIndex) {
    chosenYarn = yarnNames[num - 1];
  } else {
    const nameLower = rawInput.toLowerCase();
    chosenYarn = yarnNames.find((y) => y.toLowerCase() === nameLower || y.toLowerCase().includes(nameLower) || nameLower.includes(y.toLowerCase()));

    // Extract yarn name from phrases like "do you have this 70/2-Black (New)-Paloma Grey-Nylon/Nylon"; also treat raw "70/2-Black..." as yarn name
    const yarnNamePrefix = /^(?:\s*do\s+you\s+have\s+(?:this\s+)?|have\s+this\s+|get\s+this\s+|can\s+(?:i|you|we)\s+get\s+(?:this\s+)?|is\s+this\s+available\s+|(?:can\s+you\s+)?(?:find|search)\s+(?:me\s+)?(?:for\s+)?|i\s+(?:need|want)\s+)\s*/i;
    let yarnPart = rawInput.replace(yarnNamePrefix, '').trim();
    if (yarnPart.length < 2) yarnPart = null;
    const looksLikeYarnName = yarnPart && (/\d+[s\/]\d*|\d+\/\d+/.test(yarnPart) || (yarnPart.split('-').length >= 2 && yarnPart.length >= 8));

    if (!chosenYarn && yarnPart && looksLikeYarnName) {
      chosenYarn = yarnNames.find((y) => y.toLowerCase().includes(yarnPart.toLowerCase()) || yarnPart.toLowerCase().includes(y.toLowerCase()));
    }

    if (!chosenYarn && nameLower.length >= 2) {
      const stopwords = new Set(['anything', 'something', 'the', 'a', 'an', 'in', 'with', 'for', 'and', 'or', 'to', 'from', 'that', 'this', 'is', 'it', 'of', 'on', 'at', 'by', 'as', 'like', 'want', 'need', 'yarn', 'yarns']);
      const rawKeywords = nameLower.split(/\s+/).filter(Boolean);
      const keywords = rawKeywords.filter((w) => w.length > 1 && !stopwords.has(w));
      const searchTerms = keywords.length > 0 ? keywords : rawKeywords;
      const matches = searchTerms.length > 0
        ? yarnNames.filter((y) => searchTerms.every((kw) => y.toLowerCase().includes(kw)))
        : [];
      if (matches.length === 1) {
        chosenYarn = matches[0];
      } else if (matches.length > 1) {
        ctxCopy.yarnDisambiguationList = matches;
        const listHtml = matches.map((y, i) => `${i + 1}. ${y}`).join('<br/>');
        const html = generateHTMLResponse('Which yarn?', `Which yarn do you mean? Reply with the <strong>number</strong> (1–${matches.length}):<p class="summary" style="margin: 0.6em 0; padding-left: 1em; line-height: 1.6;">${listHtml}</p>`);
        return { html, orderWizardPrompt: 'choose_yarn_from_supplier', placeOrderContext: ctxCopy, summary: 'Multiple yarns match; choose by number.' };
      } else if (matches.length === 0 && (keywords.length > 0 || yarnPart)) {
        // No match in supplier list — do not search catalog; only use GPT fallback or show No match
        if (!chosenYarn) {
          // GPT fallback: interpret free-form reply (e.g. "the blue one", "second one") with context
          try {
            const interpreted = await interpretPlaceOrderChatMessage(rawInput, {
              yarnNames,
              supplierName: ctx.supplierName,
              collectedItems: ctx.collectedItems,
              collectingStep: ctx.collectingStep,
              collectingYarnName: ctx.collectingYarnName
            });
            if (interpreted?.action === 'list_index' && !Number.isNaN(interpreted.value) && interpreted.value >= 1 && interpreted.value <= yarnNames.length) {
              chosenYarn = yarnNames[interpreted.value - 1];
            } else if (interpreted?.action === 'search_keyword' && interpreted.value) {
              const kw = String(interpreted.value).toLowerCase();
              const gptMatches = yarnNames.filter((y) => y.toLowerCase().includes(kw));
              if (gptMatches.length === 1) chosenYarn = gptMatches[0];
              else if (gptMatches.length > 1) {
                ctxCopy.yarnDisambiguationList = gptMatches;
                const listHtml = gptMatches.map((y, i) => `${i + 1}. ${y}`).join('<br/>');
                return { html: generateHTMLResponse('Yarns matching your search', `Here are yarns with "<strong>${interpreted.value}</strong>" in the name. Reply with the <strong>number</strong> (1–${gptMatches.length}):<p class="summary" style="margin: 0.6em 0; padding-left: 1em; line-height: 1.6;">${listHtml}</p>`), orderWizardPrompt: 'choose_yarn_from_supplier', placeOrderContext: ctxCopy, summary: 'Multiple yarns match; choose by number.' };
              }
            }
          } catch (e) {
            // ignore GPT errors, show no match below
          }
        }
        if (!chosenYarn) {
          return { html: generateHTMLResponse('No match', `No yarn found matching "<strong>${rawInput}</strong>". Try a different keyword or pick from the list by number.`), orderWizardPrompt: 'choose_yarn_from_supplier', placeOrderContext: ctxCopy, summary: 'No match. Try again.' };
        }
      }
    }
  }
  if (chosenYarn) {
    ctxCopy.collectingYarnName = chosenYarn;
    ctxCopy.collectingStep = 'quantity';
    const html = generateHTMLResponse('Quantity', `How much yarn do you need for <strong>${chosenYarn}</strong>?`);
    return { html, orderWizardPrompt: 'choose_yarn_from_supplier', placeOrderContext: ctxCopy, summary: 'Enter quantity.' };
  }

  // Final GPT fallback: interpret as list index or search keyword (e.g. "the second one", "something in navy")
  try {
    const interpreted = await interpretPlaceOrderChatMessage(rawInput, {
      yarnNames,
      supplierName: ctx.supplierName,
      collectedItems: ctx.collectedItems,
      collectingStep: ctx.collectingStep,
      collectingYarnName: ctx.collectingYarnName
    });
    if (interpreted?.action === 'list_index' && !Number.isNaN(interpreted.value) && interpreted.value >= 1 && interpreted.value <= yarnNames.length) {
      const chosen = yarnNames[interpreted.value - 1];
      ctxCopy.collectingYarnName = chosen;
      ctxCopy.collectingStep = 'quantity';
      const html = generateHTMLResponse('Quantity', `How much yarn do you need for <strong>${chosen}</strong>?`);
      return { html, orderWizardPrompt: 'choose_yarn_from_supplier', placeOrderContext: ctxCopy, summary: 'Enter quantity.' };
    }
    if (interpreted?.action === 'search_keyword' && interpreted.value) {
      const kw = String(interpreted.value).toLowerCase();
      const gptMatches = yarnNames.filter((y) => y.toLowerCase().includes(kw));
      if (gptMatches.length === 1) {
        ctxCopy.collectingYarnName = gptMatches[0];
        ctxCopy.collectingStep = 'quantity';
        return { html: generateHTMLResponse('Quantity', `How much yarn do you need for <strong>${gptMatches[0]}</strong>?`), orderWizardPrompt: 'choose_yarn_from_supplier', placeOrderContext: ctxCopy, summary: 'Enter quantity.' };
      }
      if (gptMatches.length > 1) {
        ctxCopy.yarnDisambiguationList = gptMatches;
        const listHtml = gptMatches.map((y, i) => `${i + 1}. ${y}`).join('<br/>');
        return { html: generateHTMLResponse('Yarns matching your search', `Here are yarns with "<strong>${interpreted.value}</strong>". Reply with the <strong>number</strong> (1–${gptMatches.length}):<p class="summary" style="margin: 0.6em 0; padding-left: 1em; line-height: 1.6;">${listHtml}</p>`), orderWizardPrompt: 'choose_yarn_from_supplier', placeOrderContext: ctxCopy, summary: 'Multiple yarns match; choose by number.' };
      }
    }
  } catch (e) {
    // ignore
  }

  return { html: generateHTMLResponse('Choose yarn', `Reply with a <strong>number</strong> (1–${yarnNames.length}), <strong>yarn name</strong> or keywords (e.g. black nylon, light blue), or <strong>load more</strong> / <strong>done</strong>.`), orderWizardPrompt: 'choose_yarn_from_supplier', placeOrderContext: ctxCopy, summary: 'Pick a yarn or say done.' };
};

/**
 * Create yarn purchase order (place new order) from agent params
 * When params are empty, returns numbered list (choose_supplier / disambiguate_supplier) or yarn list (choose_yarn_from_supplier).
 * Expects: poNumber, supplierName, poItems: [{ yarnName, quantity, rate, sizeCount?, shadeCode?, gstRate? }], notes?
 * @param {Object} params
 * @returns {Promise<string|{html: string, orderWizardPrompt?: string, matchingSuppliers?: Array, placeOrderContext?: Object}>} HTML and prompt/context for chat flow
 */

/**
 * Use GPT to parse a free-text "buy yarn" message into structured supplier + line items.
 * Handles variations like "from allen solley 20s-Light Green-... and 20s-Beige-... 65 and 85 pieces for 60 and 75 per piece with 12% gst".
 * @param {string} userMessage - Full user message (e.g. everything after "buy yarn from " or the whole sentence)
 * @returns {Promise<{ supplierQuery: string, poItems: Array<{yarnName, quantity, rate, gstRate}> } | null>}
 */
const parseYarnOrderWithGPT = async (userMessage) => {
  const text = String(userMessage || '').trim();
  if (text.length < 20) return null;
  try {
    const response = await openai.chat.completions.create({
      model: config.openai?.model || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a parser for yarn purchase orders. Extract the supplier name and line items from the user's message.

Rules:
- supplierQuery: only the supplier/brand name (e.g. "allen solley", "Allen Solly", "wampum private limited"). No yarn names, numbers, or "pieces"/"gst"/"for" in it.
- poItems: array of objects. Each object has: yarnName (full yarn product name as given, e.g. "20s-Light Green-LT. GREEN-Bamboo/Bamboo"), quantity (number of pieces), rate (price per piece, number), gstRate (GST % as number, e.g. 12 for 12%; use same for all items if only one GST mentioned).
- If the user says "65 and 85 pieces for 60 and 75 per piece with 12% gst" for two yarns, then first yarn has quantity 65 rate 60 gstRate 12, second has quantity 85 rate 75 gstRate 12.
- Preserve exact yarn names including slashes, hyphens, and case (e.g. "20s-Light Green-LT. GREEN-Bamboo/Bamboo").
- Reply with ONLY a JSON object, no markdown or extra text: { "supplierQuery": "...", "poItems": [ { "yarnName": "...", "quantity": N, "rate": N, "gstRate": N }, ... ] }`
        },
        {
          role: 'user',
          content: `Parse this yarn order message into supplier and line items:\n\n${text}`
        }
      ],
      temperature: 0.1,
      max_tokens: 800
    });
    const content = response.choices[0]?.message?.content?.trim();
    if (!content) return null;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    const supplierQuery = (parsed.supplierQuery || '').trim();
    const poItems = Array.isArray(parsed.poItems) ? parsed.poItems : [];
    if (!supplierQuery || poItems.length === 0) return null;
    const normalized = poItems.map((it) => ({
      yarnName: (it.yarnName || it.yarn_name || it.name || '').trim(),
      quantity: Number(it.quantity) || 0,
      rate: Number(it.rate) || 0,
      gstRate: Number(it.gstRate) ?? Number(parsed.defaultGst) ?? 0
    })).filter((it) => it.yarnName && (it.quantity > 0 || it.rate > 0));
    if (normalized.length === 0) return null;
    return { supplierQuery, poItems: normalized };
  } catch (err) {
    console.warn('parseYarnOrderWithGPT failed:', err?.message);
    return null;
  }
};

/**
 * Use GPT to interpret any yarn-purchase-related message with context. Returns structured params for createYarnPurchaseOrder or "show_lists".
 * Makes the chat free-flow: handles "get me yarn from allen solley in blue", "i need 20s black from wampum 50 pieces at 60", etc.
 * @param {string} userMessage - Full user message
 * @param {Object} context - Optional: { inPlaceOrderFlow, supplierName, yarnNames[], collectedItems[] }
 * @returns {Promise<{ intent: string, supplierQuery?: string, yarnHint?: string, poItems?: Array, rawMessage?: string } | null>}
 */
export const interpretYarnPurchaseMessage = async (userMessage, context = {}) => {
  const text = String(userMessage || '').trim();
  if (text.length < 3) return null;
  try {
    const ctxStr = context.yarnNames?.length
      ? `Current supplier: ${context.supplierName || 'none'}. Available yarn names (sample): ${(context.yarnNames || []).slice(0, 15).join(', ')}.`
      : '';
    const response = await openai.chat.completions.create({
      model: config.openai?.model || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a yarn purchase intent parser. Extract structured data from the user's message for a yarn ordering system.

Return ONLY a JSON object, no markdown or explanation.

Possible intents:
- "create_order": user wants to place an order. Extract supplierQuery (supplier/brand name only, e.g. "allen solley", "wampum"), and if they specified yarns with quantities/rates/gst then poItems array. Each poItem: { yarnName, quantity, rate, gstRate }. Preserve exact yarn names (e.g. "20s-Light Green-LT. GREEN-Bamboo/Bamboo"). If they only said a colour (e.g. "blue yarn from X") set yarnHint to that colour and leave poItems empty.
- "show_lists": user wants to buy yarn but didn't name supplier or colour (e.g. "i want to buy yarn", "get some yarn"). Return intent "show_lists", no supplierQuery.
- "choose_supplier": same as create_order but only supplier name given (e.g. "from allen solley").

Rules:
- supplierQuery: ONLY the supplier or brand name, no yarn names, no numbers, no "pieces"/"gst"/"for". Normalize spelling (e.g. "allen solley" not "Allen Solley").
- yarnHint: colour or keyword when user says "in blue", "something black", "blue yarn" etc.
- poItems: only when user gave specific yarn names with quantities and/or rates. Preserve full yarn names. Map "65 and 85 pieces for 60 and 75 per piece with 12% gst" to two items with quantity 65 rate 60 gstRate 12 and quantity 85 rate 75 gstRate 12.
- If message is not about buying/ordering yarn, return { "intent": "none" }.

Format: { "intent": "...", "supplierQuery": "" or string, "yarnHint": "" or string, "poItems": [] or array of { yarnName, quantity, rate, gstRate } }`
        },
        {
          role: 'user',
          content: `${ctxStr ? `Context: ${ctxStr}\n\n` : ''}User message: ${text}`
        }
      ],
      temperature: 0.1,
      max_tokens: 600
    });
    const content = response.choices[0]?.message?.content?.trim();
    if (!content) return null;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.intent === 'none' || !parsed.intent) return null;
    const result = {
      intent: parsed.intent || 'create_order',
      supplierQuery: (parsed.supplierQuery || '').trim() || undefined,
      yarnHint: (parsed.yarnHint || '').trim() || undefined,
      poItems: Array.isArray(parsed.poItems) ? parsed.poItems.map((it) => ({
        yarnName: (it.yarnName || it.yarn_name || it.name || '').trim(),
        quantity: Number(it.quantity) || 0,
        rate: Number(it.rate) || 0,
        gstRate: Number(it.gstRate) ?? 0
      })).filter((it) => it.yarnName) : undefined
    };
    if (result.intent === 'show_lists') return result;
    if (result.intent === 'create_order' && !result.supplierQuery && !result.poItems?.length) return null;
    return result;
  } catch (err) {
    console.warn('interpretYarnPurchaseMessage failed:', err?.message);
    return null;
  }
};

/**
 * Use GPT to interpret a user reply inside the place-order chat (choose yarn / quantity / rate step) with context.
 * E.g. "the blue one", "second one", "add 50 more", "same as before but 100 pieces" -> search keyword or list index or quantity.
 * @param {string} userMessage - User's reply
 * @param {Object} context - { yarnNames[], supplierName, collectedItems[], collectingStep?, collectingYarnName? }
 * @returns {Promise<{ action: 'search_keyword'|'list_index'|'quantity'|'rate'|'none', value: string|number } | null>}
 */
const interpretPlaceOrderChatMessage = async (userMessage, context = {}) => {
  const text = String(userMessage || '').trim();
  if (text.length < 2) return null;
  try {
    const yarnList = (context.yarnNames || []).slice(0, 20).join('\n');
    const lastItem = context.collectedItems?.length ? context.collectedItems[context.collectedItems.length - 1] : null;
    const response = await openai.chat.completions.create({
      model: config.openai?.model || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are interpreting a user message during a yarn order flow. The user is choosing yarns, entering quantity, or rate.

Current context: Supplier: ${context.supplierName || 'unknown'}. User is ${context.collectingStep === 'quantity' ? 'entering quantity for: ' + (context.collectingYarnName || '') : context.collectingStep === 'rate' ? 'entering rate for: ' + (context.collectingYarnName || '') : context.collectingStep === 'disambiguation' ? 'picking one option by number from the list below (reply with list_index 1-based)' : 'choosing a yarn from the list'}.
${lastItem ? `Last added item: ${lastItem.yarnName} qty ${lastItem.quantity} rate ${lastItem.rate}.` : ''}

Yarn list (numbered 1 to N):
${yarnList || 'No list'}

Return ONLY a JSON object:
- If user is clearly selecting by position/number: { "action": "list_index", "value": <number 1-based> }. Examples: "the second one" -> 2, "number 3" -> 3, "i want 3" -> 3, "3 onw" or "3 one" (typo) -> 3, "the third one" -> 3, "option 2" -> 2.
- If user is asking for a colour/keyword to search: { "action": "search_keyword", "value": "<keyword>" } e.g. "something blue" -> "blue", "do you have black" -> "black", "does this supplier have anything in 20-blue" -> "20-blue", "anything in 20-blue" -> "20-blue".
- If user is giving a quantity (number of pieces): { "action": "quantity", "value": <number> }.
- If user is giving a rate/price: { "action": "rate", "value": <number> }.
- If unclear or not applicable: { "action": "none" }.`
        },
        { role: 'user', content: text }
      ],
      temperature: 0.1,
      max_tokens: 80
    });
    const content = response.choices[0]?.message?.content?.trim();
    if (!content) return null;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.action || parsed.action === 'none') return null;
    const value = parsed.value;
    if (parsed.action === 'list_index') return { action: 'list_index', value: typeof value === 'number' ? value : parseInt(String(value), 10) };
    if (parsed.action === 'search_keyword') return { action: 'search_keyword', value: String(value || '').trim() };
    if (parsed.action === 'quantity') return { action: 'quantity', value: typeof value === 'number' ? value : parseFloat(String(value)) };
    if (parsed.action === 'rate') return { action: 'rate', value: typeof value === 'number' ? value : parseFloat(String(value)) };
    return null;
  } catch (err) {
    console.warn('interpretPlaceOrderChatMessage failed:', err?.message);
    return null;
  }
};

/**
 * Use GPT to interpret user intent when regex/fuzzy matching fails for supplier selection.
 * E.g. "ok from allen", "the first one", "allen please" -> supplier name or 1-based index.
 * @param {string} userMessage - Raw user reply (e.g. "ok from allen")
 * @param {Array<{ _id?: string, id?: string, brandName?: string, name?: string }>} suppliers - List of suppliers (same order as shown to user, 1-based index)
 * @returns {Promise<{ supplierNumber?: number, supplierQuery?: string } | null>}
 */
const interpretSupplierChoiceWithGPT = async (userMessage, suppliers) => {
  const text = String(userMessage || '').trim();
  if (text.length < 1 || !Array.isArray(suppliers) || suppliers.length === 0) return null;
  try {
    const listStr = suppliers
      .slice(0, 30)
      .map((s, i) => `${i + 1}. ${s.brandName || s.name || 'Unknown'}`)
      .join('\n');
    const response = await openai.chat.completions.create({
      model: config.openai?.model || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are interpreting a user's reply when they were shown a list of suppliers and asked to choose one.

Suppliers (numbered 1 to N):
${listStr}

The user replied with a short message (e.g. "ok from allen", "the first one", "allen", "number 2", "go with premier threads").

Return ONLY a JSON object, no markdown:
- If they are clearly choosing by position: { "supplierNumber": <1-based index> }. E.g. "the first one" -> 1, "number 2" -> 2, "second" -> 2.
- If they are naming the supplier (full or partial): { "supplierQuery": "<supplier name or part of name>" }. E.g. "ok from allen" -> "Allen Solley" or "allen", "from allen" -> "allen", "wampum" -> "WAMPUM", "premier" -> "Premier Threads". Use the closest matching name from the list when possible.
- If unclear or not a supplier choice: { "supplierNumber": null, "supplierQuery": null }.`
        },
        { role: 'user', content: text }
      ],
      temperature: 0.1,
      max_tokens: 120
    });
    const content = response.choices[0]?.message?.content?.trim();
    if (!content) return null;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    const num = parsed.supplierNumber != null ? parseInt(parsed.supplierNumber, 10) : null;
    const query = (parsed.supplierQuery || '').trim() || undefined;
    if (num != null && !Number.isNaN(num) && num >= 1 && num <= suppliers.length) {
      return { supplierNumber: num };
    }
    if (query && query.length >= 2) return { supplierQuery: query };
    return null;
  } catch (err) {
    console.warn('interpretSupplierChoiceWithGPT failed:', err?.message);
    return null;
  }
};

/**
 * Parse "supplier yarn1 and yarn2 and yarn3 ... qty1 and qty2 and qty3 pieces for rate1 and rate2 and rate3 with 12% gst" (or "with 12% and 18% gst" for per-item GST).
 * Supports 2 or more items with different pieces, rates, and optional per-item GST.
 * @returns {{ supplierQuery: string, poItems: Array<{yarnName, quantity, rate, gstRate}> } | null}
 */
const parseSupplierAndOrderFromPhrase = (fullQuery) => {
  const s = String(fullQuery).trim();
  if (s.length < 30 || !/\bpieces?\b/i.test(s) || (!/\bgst\b/i.test(s) && !/for\s+\d/i.test(s))) return null;
  // Supplier name ends before yarn pattern: "20s-", "30/2-", "40s ", etc. (no trailing space required after -/.)
  const supplierEnd = s.match(/\s+(\d{1,4}s?[-\.\/]|\d{1,4}\/\d{1,4})[-\.\s\/]/i);
  if (!supplierEnd) return null;
  const supplierQuery = s.slice(0, supplierEnd.index).trim();
  if (supplierQuery.length < 2) return null;
  let orderPart = s.slice(supplierEnd.index).trim();
  // Strip "with 12% gst" or "with 12% and 18% and 5% gst" (one or more GST values) from end
  const withGstMatch = orderPart.match(/\s+with\s+([\d.\s%+and]+)\s*gst\s*$/i);
  let gstRates = [];
  if (withGstMatch) {
    const gstStr = withGstMatch[1];
    gstRates = gstStr.split(/\s+and\s+/).map((x) => parseFloat(x.replace(/%/g, '').trim())).filter((n) => !Number.isNaN(n) && n >= 0);
    orderPart = orderPart.replace(/\s+with\s+[\d.\s%+and]+\s*gst\s*$/i, '').trim();
  }
  const defaultGst = gstRates.length > 0 ? gstRates[0] : 0;
  // Strip "for 60 and 75" or "for 60 and 75 per piece" or "for 60 and 75 each" (one or more rates) from end
  const forRatesMatch = orderPart.match(/\s+for\s+([\d.\s+and]+)(?:\s+per\s+piece|\s+each)?\s*$/i);
  let rates = [];
  if (forRatesMatch) {
    rates = forRatesMatch[1].split(/\s+and\s+/).map((x) => parseFloat(x.trim())).filter((n) => !Number.isNaN(n));
    orderPart = orderPart.replace(/\s+for\s+[\d.\s+and]+(?:\s+per\s+piece|\s+each)?\s*$/i, '').trim();
  }
  // Strip "65 and 85 and 100 pieces" (one or more quantities) from end
  const piecesMatch = orderPart.match(/\s+([\d\s+and]+)\s+pieces?\s*$/i);
  let quantities = [];
  if (piecesMatch) {
    quantities = piecesMatch[1].split(/\s+and\s+/).map((x) => parseInt(x.trim(), 10)).filter((n) => !Number.isNaN(n) && n > 0);
    orderPart = orderPart.replace(/\s+[\d\s+and]+\s+pieces?\s*$/i, '').trim();
  }
  // Remainder = "20s-Light Green-... and 20s-Beige-... and 20s-..." — split by " and " (before a yarn pattern)
  const yarnNames = orderPart.split(/\s+and\s+(?=\d{1,4}s?[-\.\/]|\d{1,4}\/\d)/i).map((x) => x.trim()).filter(Boolean);
  if (yarnNames.length === 0) return null;
  const n = Math.max(yarnNames.length, quantities.length, rates.length, 1);
  const poItems = [];
  for (let i = 0; i < n; i++) {
    poItems.push({
      yarnName: yarnNames[Math.min(i, yarnNames.length - 1)],
      quantity: quantities[i] ?? quantities[quantities.length - 1] ?? 0,
      rate: rates[i] ?? rates[rates.length - 1] ?? 0,
      gstRate: gstRates[i] ?? gstRates[gstRates.length - 1] ?? defaultGst
    });
  }
  return { supplierQuery, poItems };
};

export const createYarnPurchaseOrder = async (params = {}) => {
  try {
    let safeParams = params ?? {};
    let { poNumber, supplierName, supplier: supplierId, poItems: rawItems, notes, showSupplierList, supplierQuery, preSelectedSupplierId, supplierNumber, yarnHint } = safeParams;
    // If supplierQuery contains full order in one line, let GPT parse first (then regex fallback) into supplier + poItems
    if (supplierQuery && typeof supplierQuery === 'string' && supplierQuery.trim().length > 50) {
      const raw = supplierQuery.trim();
      const looksLikeOrder = /\bpieces?\b/i.test(raw) || /\bgst\b/i.test(raw) || /for\s+\d/i.test(raw);
      let parsed = null;
      if (looksLikeOrder) {
        parsed = await parseYarnOrderWithGPT(raw);
      }
      if (!parsed || parsed.poItems.length === 0) {
        parsed = parseSupplierAndOrderFromPhrase(raw);
      }
      if (parsed && parsed.poItems.length > 0) {
        supplierQuery = parsed.supplierQuery;
        rawItems = parsed.poItems;
        safeParams = { ...safeParams, supplierQuery, poItems: rawItems };
      }
    }
    const hasOrderDetails = poNumber && (supplierName || supplierId) && Array.isArray(rawItems) && rawItems.length > 0;

    if (!hasOrderDetails) {
      // "Buy [yarn] from [supplier]" — resolve supplier, validate yarn(s); if all items have qty+rate, create order directly; else return numbered-list flow
      const initialItems = Array.isArray(rawItems) ? rawItems : (rawItems && typeof rawItems === 'object' ? [rawItems] : []);
      const yarnOnlyItems = initialItems.filter((it) => (it.yarnName || it.yarn_name || it.name || '').trim());
      const allItemsHaveQtyAndRate = yarnOnlyItems.length > 0 && yarnOnlyItems.every(
        (it) => Number(it.quantity) > 0 && Number(it.rate) > 0
      );
      if (supplierQuery && typeof supplierQuery === 'string' && supplierQuery.trim() && yarnOnlyItems.length > 0) {
        let query = supplierQuery.trim();
        // Normalize "ok from allen" / "from allen" / "go with wampum" etc. to just the supplier name part for matching
        if (!/^\d+$/.test(query)) {
          const normalized = query
            .replace(/^(?:ok(?:ay)?\s+)?from\s+/i, '')
            .replace(/^(?:go\s+with|lets?\s+go\s+with|i\s+(?:want|ll\s+take)|(?:get|order|buy)\s+from)\s+/i, '')
            .replace(/^(?:ok(?:ay)?\s+)/i, '')
            .replace(/\s+(?:please|thanks\.?)$/i, '')
            .trim();
          if (normalized.length > 0) query = normalized;
        }
        const num = supplierNumber != null ? Number(supplierNumber) : (/^\d+$/.test(query) ? parseInt(query, 10) : null);
        if (num != null && !Number.isNaN(num) && num >= 1) {
          const allRes = await supplierService.querySuppliers({}, { limit: 50, page: 1 });
          const allList = allRes?.results ?? allRes ?? [];
          const one = allList[num - 1];
          if (one) {
            const id = one._id?.toString?.() || one.id;
            const brandName = one.brandName || one.name || 'Unknown';
            const supplier = await supplierService.getSupplierById(id);
            let yarnNames = supplier?.yarnDetails?.length
              ? [...new Set((supplier.yarnDetails || []).map((d) => (d.yarnName || (d.yarnType && d.yarnType.name) || '').trim()).filter(Boolean))]
              : [];
            // Only show yarns this supplier actually has — do not enrich from catalog
            const pageSize = 5;
            const page = 1;
            const slice = yarnNames.slice(0, pageSize);
            const hasMore = yarnNames.length > pageSize;
            const listHtml = slice.map((y, i) => `${i + 1}. ${y}`).join('<br/>');
            const html = generateHTMLResponse(
              'Choose yarn',
              `<p>You chose <strong>${brandName}</strong>. Here are yarn items (top ${slice.length}):</p><p class="summary" style="margin: 0.6em 0; padding-left: 1em; line-height: 1.6;">${listHtml || 'No yarn list on file.'}</p>${hasMore ? `<p class="summary">Reply with <strong>load more</strong> for more options.</p>` : ''}<p class="summary" style="margin-top: 0.8em;">Reply with the <strong>number or name</strong> of the yarn to add, or <strong>load more</strong> for more.</p>`
            );
            return {
              html,
              orderWizardPrompt: 'choose_yarn_from_supplier',
              placeOrderContext: { supplierId: id, supplierName: brandName, yarnNames, page }
            };
          }
        }
        // Strip order-detail phrases so "wumpum private limited, 50 pieces at 500 each, gst 12%" or "wumpum private limited i want 50 pieces..." -> "wumpum private limited"
        query = query.replace(/\s*,\s*(?:and\s+)?gst\s+(?:is\s+)?\d+(?:\.\d+)?\s*%?/gi, '').trim();
        query = query.replace(/\s+(?:and\s+)?gst\s+(?:is\s+)?\d+(?:\.\d+)?\s*%?/gi, '').trim();
        const eachPieceAt = query.match(/\s+(?:and\s+)?(?:each\s+piece\s+at|at)\s+(?:₹|rs\.?|rupees?\s+)?(\d+(?:\.\d+)?)(?:\s*per\s*piece)?(?:\s*each)?/i);
        if (eachPieceAt) query = query.slice(0, eachPieceAt.index).trim();
        const eachPieceAtComma = query.match(/\s*,\s*\d+\s*pieces?\s*(?:(?:and\s+)?(?:each\s+piece\s+at|at)\s+(?:₹|rs\.?|rupees?\s+)?\d+(?:\.\d+)?\s*(?:each|per\s*piece)?)?/i);
        if (eachPieceAtComma) query = query.slice(0, eachPieceAtComma.index).trim();
        const iWantPieces = query.match(/\s+i\s+want\s+\d+\s*pieces?/i);
        if (iWantPieces) query = query.slice(0, iWantPieces.index).trim();
        query = query.replace(/\s*,\s*\d+\s*pieces?/gi, '').trim();
        const words = query.split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        const fuzzyPattern = words.length ? words.join('.*') : query;
        const suppliersResult = await supplierService.querySuppliers({ brandName: fuzzyPattern }, { limit: 20, page: 1 });
        let matches = suppliersResult?.results ?? suppliersResult ?? [];
        if (matches.length === 0) {
          const allSuppliersResult = await supplierService.querySuppliers({}, { limit: 200, page: 1 });
          const allSuppliers = allSuppliersResult?.results ?? allSuppliersResult ?? [];
          const nearest = findNearestSupplierByTypo(query, allSuppliers, { maxTotalEditDistance: 6, maxPerWord: 2 });
          if (nearest) matches = [{ _id: nearest.best.id, brandName: nearest.best.brandName }];
          if (matches.length === 0) {
            const gptChoice = await interpretSupplierChoiceWithGPT(supplierQuery.trim(), allSuppliers);
            if (gptChoice?.supplierNumber) {
              const one = allSuppliers[gptChoice.supplierNumber - 1];
              if (one) matches = [{ _id: one._id, brandName: one.brandName || one.name }];
            } else if (gptChoice?.supplierQuery) {
              const nearestGpt = findNearestSupplierByTypo(gptChoice.supplierQuery, allSuppliers, { maxTotalEditDistance: 6, maxPerWord: 2 });
              if (nearestGpt) matches = [{ _id: nearestGpt.best.id, brandName: nearestGpt.best.brandName }];
            }
          }
        }
        if (matches.length === 0) {
          return generateHTMLResponse('Supplier not found', `No supplier found matching "${query}". Please check the name or choose from the supplier list.`);
        }
        const one = matches[0];
        const supplierId = one._id?.toString?.() || one.id;
        const supplierBrandName = one.brandName || one.name || 'Unknown';
        const catalogYarns = [];
        const resolvedOnePerItem = [];
        let fallbackToColourHint = false;
        let colourHintForFallback = '';
        for (const it of yarnOnlyItems) {
          const yarnName = (it.yarnName || it.yarn_name || it.name || '').trim();
          const sizeCount = (it.sizeCount || '').trim() || undefined;
          let catalogResult = await yarnCatalogService.queryYarnCatalogs(sizeCount ? { yarnName, sizeCount } : { yarnName }, { limit: 20 });
          let results = catalogResult?.results ?? catalogResult ?? [];
          if (results.length === 0 && sizeCount) {
            catalogResult = await yarnCatalogService.queryYarnCatalogs({ yarnName }, { limit: 20 });
            results = (catalogResult?.results ?? catalogResult ?? []).filter(
              (y) => (y.yarnName && y.yarnName.startsWith(sizeCount + '-')) || (y.countSize && String(y.countSize.name || '').trim() === String(sizeCount).trim())
            );
          }
          if (results.length === 0) {
            // Yarn not in catalog: treat as colour hint — show supplier's top 5 + 3 options (change supplier, another colour, choose from table)
            fallbackToColourHint = true;
            colourHintForFallback = yarnName.replace(/\s+yarn\s*$/i, '').trim() || yarnName;
            break;
          }
          const pickOne = (y) => {
            const countSizes = [];
            if (y.countSize && (y.countSize._id || y.countSize.id)) {
              const id = (y.countSize._id || y.countSize.id).toString?.() || y.countSize._id || y.countSize.id;
              const name = y.countSize.name || id;
              if (!countSizes.some((cs) => cs.id === id)) countSizes.push({ id, name });
            }
            const subtypeCountSizes = y.yarnSubtype?.countSize || [];
            if (Array.isArray(subtypeCountSizes)) {
              subtypeCountSizes.forEach((cs) => {
                const id = (cs?._id || cs?.id)?.toString?.() || cs;
                const name = (typeof cs === 'object' && (cs?.name || cs?.label)) || id;
                if (id && !countSizes.some((c) => c.id === (id.toString?.() || id))) {
                  countSizes.push({ id: id.toString?.() || id, name });
                }
              });
            }
            let shadeCode = (y.pantonShade || y.pantonName || (y.colorFamily?.name || '')).trim() || undefined;
            if (!shadeCode && (y.yarnName || y.name)) {
              const nameStr = (y.yarnName || y.name || '').trim();
              const parts = nameStr.split('-').map((p) => p.trim()).filter(Boolean);
              if (parts.length >= 2) shadeCode = parts[1] || parts[2] || undefined;
            }
            return {
              id: (y._id || y.id)?.toString?.() || '',
              yarnName: y.yarnName || y.name || 'Unknown',
              countSizes: countSizes.length ? countSizes : undefined,
              shadeCode
            };
          };
          if (sizeCount || results.length === 1) {
            const y = results[0];
            const entry = pickOne(y);
            catalogYarns.push(entry);
            resolvedOnePerItem.push(entry);
          } else {
            for (const y of results) catalogYarns.push(pickOne(y));
            resolvedOnePerItem.push(null);
          }
        }
        // When yarn was not found in catalog, show supplier's top 5 + 3 options (change supplier, another colour, choose from table)
        if (fallbackToColourHint && colourHintForFallback) {
          const supplier = await supplierService.getSupplierById(supplierId);
          let yarnNames = supplier?.yarnDetails?.length
            ? [...new Set((supplier.yarnDetails || []).map((d) => (d.yarnName || (d.yarnType && d.yarnType.name) || '').trim()).filter(Boolean))]
            : [];
          const h = colourHintForFallback.toLowerCase();
          const matching = yarnNames.filter((y) => y.toLowerCase().includes(h));
          let displayYarnNames = yarnNames;
          let noColourMatchMessage = '';
          if (matching.length > 0) {
            displayYarnNames = matching;
          } else {
            noColourMatchMessage = `This supplier has nothing in <strong>${colourHintForFallback}</strong>. You can: <strong>change supplier</strong>, <strong>look for another colour</strong>, or <strong>choose from the table below</strong>.`;
          }
          const pageSize = 5;
          const slice = displayYarnNames.slice(0, pageSize);
          const hasMore = displayYarnNames.length > pageSize;
          const listHtml = slice.map((y, i) => `${i + 1}. ${y}`).join('<br/>');
          const intro = noColourMatchMessage
            ? `<p>${noColourMatchMessage}</p><p>Here are yarn items from <strong>${supplierBrandName}</strong> (top ${slice.length}):</p>`
            : `Here are yarn items from <strong>${supplierBrandName}</strong> with "<strong>${colourHintForFallback}</strong>" in the name:`;
          const html = generateHTMLResponse(
            'Choose yarn',
            `<p>${intro}</p><p class="summary" style="margin: 0.6em 0; padding-left: 1em; line-height: 1.6;">${listHtml || 'No yarn list on file.'}</p>${hasMore ? `<p class="summary">Reply with <strong>load more</strong> for more options.</p>` : ''}<p class="summary" style="margin-top: 0.8em;">Reply with the <strong>number or name</strong> of the yarn to add, or <strong>load more</strong> for more.</p>`
          );
          return {
            html,
            orderWizardPrompt: 'choose_yarn_from_supplier',
            placeOrderContext: { supplierId, supplierName: supplierBrandName, yarnNames: displayYarnNames, page: 1 }
          };
        }
        const canDirectOrder = allItemsHaveQtyAndRate && resolvedOnePerItem.every((e) => e != null) && resolvedOnePerItem.length === yarnOnlyItems.length;
        if (canDirectOrder) {
          // Build collectedItems for order summary and confirmation (do not place yet — ask permission)
          const collectedItems = [];
          for (let i = 0; i < yarnOnlyItems.length; i++) {
            const it = yarnOnlyItems[i];
            const y = resolvedOnePerItem[i];
            collectedItems.push({
              yarnName: y.yarnName,
              quantity: Number(it.quantity) || 0,
              rate: Number(it.rate) || 0,
              gstRate: Number(it.gstRate) || 0,
              sizeCount: (it.sizeCount || '').trim() || undefined,
              shadeCode: (it.shadeCode || '').trim() || undefined
            });
          }
          const placeOrderContext = {
            supplierId,
            supplierName: supplierBrandName,
            collectedItems
          };
          const html = buildPlaceOrderSummaryHtml(placeOrderContext);
          return {
            html,
            needsPlaceOrderConfirmation: true,
            placeOrderContext,
            summary: 'Review your order. Type yes to place or no to cancel.'
          };
        }
        const [suppliersResultAll, nextPoNumber] = await Promise.all([
          supplierService.querySuppliers({}, { limit: 200, page: 1 }),
          yarnPurchaseOrderService.getNextSuggestedPoNumber()
        ]);
        const suppliersAll = suppliersResultAll?.results ?? suppliersResultAll ?? [];
        const suppliersList = suppliersAll.map((s) => ({
          id: (s._id || s.id)?.toString?.() || s.id,
          brandName: s.brandName || s.name || 'Unknown'
        }));
        const yarnNamesList = catalogYarns.map((y) => y.yarnName).join(', ');
        // Numbered-list flow: show yarn list and continue in chat (no wizard). Pre-fill collectedItems from initial request.
        const supplierForYarns = await supplierService.getSupplierById(supplierId);
        const yarnNames = supplierForYarns?.yarnDetails?.length
          ? [...new Set((supplierForYarns.yarnDetails || []).map((d) => (d.yarnName || (d.yarnType && d.yarnType.name) || '').trim()).filter(Boolean))]
          : [];
        const pageSize = 5;
        const slice = yarnNames.slice(0, pageSize);
        const hasMore = yarnNames.length > pageSize;
        const listHtml = slice.map((y, i) => `${i + 1}. ${y}`).join('<br/>');
        const collectedItems = yarnOnlyItems.map((it) => ({
          yarnName: it.yarnName || it.name || 'Unknown',
          quantity: Number(it.quantity) || 0,
          rate: Number(it.rate) || 0,
          gstRate: Number(it.gstRate) ?? 0
        })).filter((it) => it.yarnName && (it.quantity > 0 || it.rate > 0));
        const introHtml = generateHTMLResponse(
          'Choose yarn',
          `<p>You want <strong>${yarnNamesList}</strong> from <strong>${supplierBrandName}</strong>.</p><p class="summary" style="margin: 0.6em 0; padding-left: 1em; line-height: 1.6;">${listHtml || 'No yarn list on file.'}</p>${hasMore ? `<p class="summary">Reply with <strong>load more</strong> for more options.</p>` : ''}<p class="summary" style="margin-top: 0.8em;">Reply with the <strong>number or name</strong> of a yarn to add, or <strong>done</strong> to place order${collectedItems.length > 0 ? ` (you already have ${collectedItems.length} item(s)).` : '.'}</p>`
        );
        return {
          html: introHtml,
          orderWizardPrompt: 'choose_yarn_from_supplier',
          placeOrderContext: { supplierId, supplierName: supplierBrandName, yarnNames, page: 1, collectedItems }
        };
      }

      // User mentioned a supplier name only: look up with fuzzy/partial match so "wampum limited 2" finds "WAMPUM SYNTEX PRIVATE LIMITED 2"
      if (supplierQuery && typeof supplierQuery === 'string' && supplierQuery.trim()) {
        let query = supplierQuery.trim();
        // Normalize "ok from allen" / "from allen" / "go with wampum" etc. to just the supplier name part for matching
        if (!/^\d+$/.test(query)) {
          const normalized = query
            .replace(/^(?:ok(?:ay)?\s+)?from\s+/i, '')
            .replace(/^(?:go\s+with|lets?\s+go\s+with|i\s+(?:want|ll\s+take)|(?:get|order|buy)\s+from)\s+/i, '')
            .replace(/^(?:ok(?:ay)?\s+)/i, '')
            .replace(/\s+(?:please|thanks\.?)$/i, '')
            .trim();
          if (normalized.length > 0) query = normalized;
        }
        const num = supplierNumber != null ? Number(supplierNumber) : (/^\d+$/.test(query) ? parseInt(query, 10) : null);
        if (num != null && !Number.isNaN(num) && num >= 1) {
          const allRes = await supplierService.querySuppliers({}, { limit: 50, page: 1 });
          const allList = allRes?.results ?? allRes ?? [];
          const one = allList[num - 1];
          if (one) {
            const id = one._id?.toString?.() || one.id;
            const brandName = one.brandName || one.name || 'Unknown';
            const supplier = await supplierService.getSupplierById(id);
            let yarnNames = supplier?.yarnDetails?.length
              ? [...new Set((supplier.yarnDetails || []).map((d) => (d.yarnName || (d.yarnType && d.yarnType.name) || '').trim()).filter(Boolean))]
              : [];
            let displayYarnNames = yarnNames;
            let filterLabel = '';
            let noColourMatchMessage = '';
            if (yarnHint && String(yarnHint).trim()) {
              const h = String(yarnHint).trim().toLowerCase();
              const matching = yarnNames.filter((y) => y.toLowerCase().includes(h));
              if (matching.length > 0) {
                displayYarnNames = matching;
                filterLabel = ` with "<strong>${yarnHint}</strong>" in the name`;
              } else {
                noColourMatchMessage = `This supplier has nothing in <strong>${yarnHint}</strong>. You can: <strong>change supplier</strong>, <strong>look for another colour</strong>, or <strong>choose from the table below</strong>.`;
              }
            }
            const pageSize = 5;
            const slice = displayYarnNames.slice(0, pageSize);
            const hasMore = displayYarnNames.length > pageSize;
            const listHtml = slice.map((y, i) => `${i + 1}. ${y}`).join('<br/>');
            const intro = noColourMatchMessage
              ? `<p>${noColourMatchMessage}</p><p>Here are yarn items from <strong>${brandName}</strong> (top ${slice.length}):</p>`
              : filterLabel
                ? `Here are yarn items from <strong>${brandName}</strong>${filterLabel}:`
                : `You chose <strong>${brandName}</strong>. Here are yarn items (top ${slice.length}):`;
            const html = generateHTMLResponse(
              'Choose yarn',
              `<p>${intro}</p><p class="summary" style="margin: 0.6em 0; padding-left: 1em; line-height: 1.6;">${listHtml || 'No yarn list on file.'}</p>${hasMore ? `<p class="summary">Reply with <strong>load more</strong> for more options.</p>` : ''}<p class="summary" style="margin-top: 0.8em;">Reply with the <strong>number or name</strong> of the yarn to add, or <strong>load more</strong> for more.</p>`
            );
            return {
              html,
              orderWizardPrompt: 'choose_yarn_from_supplier',
              placeOrderContext: { supplierId: id, supplierName: brandName, yarnNames: displayYarnNames, page: 1 }
            };
          }
        }
        // Strip order-detail phrases so supplier name is clean for lookup (including ", 50 pieces at 500 each, gst 12%")
        query = query.replace(/\s*,\s*(?:and\s+)?gst\s+(?:is\s+)?\d+(?:\.\d+)?\s*%?/gi, '').trim();
        query = query.replace(/\s+(?:and\s+)?gst\s+(?:is\s+)?\d+(?:\.\d+)?\s*%?/gi, '').trim();
        const eachPieceAt = query.match(/\s+(?:and\s+)?(?:each\s+piece\s+at|at)\s+(?:₹|rs\.?|rupees?\s+)?(\d+(?:\.\d+)?)(?:\s*per\s*piece)?(?:\s*each)?/i);
        if (eachPieceAt) query = query.slice(0, eachPieceAt.index).trim();
        const eachPieceAtComma = query.match(/\s*,\s*\d+\s*pieces?\s*(?:(?:and\s+)?(?:each\s+piece\s+at|at)\s+(?:₹|rs\.?|rupees?\s+)?\d+(?:\.\d+)?\s*(?:each|per\s*piece)?)?/i);
        if (eachPieceAtComma) query = query.slice(0, eachPieceAtComma.index).trim();
        const iWantPieces = query.match(/\s+i\s+want\s+\d+\s*pieces?/i);
        if (iWantPieces) query = query.slice(0, iWantPieces.index).trim();
        query = query.replace(/\s*,\s*\d+\s*pieces?/gi, '').trim();
        const words = query.split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        const fuzzyPattern = words.length ? words.join('.*') : query;
        const suppliersResult = await supplierService.querySuppliers(
          { brandName: fuzzyPattern },
          { limit: 20, page: 1 }
        );
        let matches = suppliersResult?.results ?? suppliersResult ?? [];
        if (matches.length === 0) {
          const allSuppliersResult = await supplierService.querySuppliers({}, { limit: 200, page: 1 });
          const allSuppliers = allSuppliersResult?.results ?? allSuppliersResult ?? [];
          const nearest = findNearestSupplierByTypo(query, allSuppliers, { maxTotalEditDistance: 6, maxPerWord: 2 });
          if (nearest) {
            const { best, score } = nearest;
            if (score <= 2) {
              const supplier = await supplierService.getSupplierById(best.id);
              let yarnNames = supplier?.yarnDetails?.length
                ? [...new Set((supplier.yarnDetails || []).map((d) => (d.yarnName || (d.yarnType && d.yarnType.name) || '').trim()).filter(Boolean))]
                : [];
              let displayYarnNames = yarnNames;
              let filterLabel = '';
              let noColourMatchMessage = '';
              if (yarnHint && String(yarnHint).trim()) {
                const h = String(yarnHint).trim().toLowerCase();
                const matching = yarnNames.filter((y) => y.toLowerCase().includes(h));
                if (matching.length > 0) {
                  displayYarnNames = matching;
                  filterLabel = ` with "<strong>${yarnHint}</strong>" in the name`;
                } else {
                  noColourMatchMessage = `This supplier has nothing in <strong>${yarnHint}</strong>. You can: <strong>change supplier</strong>, <strong>look for another colour</strong>, or <strong>choose from the table below</strong>.`;
                }
              }
              const pageSize = 5;
              const slice = displayYarnNames.slice(0, pageSize);
              const hasMore = displayYarnNames.length > pageSize;
              const listHtml = slice.map((y, i) => `${i + 1}. ${y}`).join('<br/>');
              const intro = noColourMatchMessage
                ? `<p>${noColourMatchMessage}</p><p>Here are yarn items from <strong>${best.brandName}</strong> (top ${slice.length}):</p>`
                : filterLabel
                  ? `Here are yarn items from <strong>${best.brandName}</strong>${filterLabel}:`
                  : `You chose <strong>${best.brandName}</strong>. Here are yarn items (top ${slice.length}):`;
              const html = generateHTMLResponse(
                'Choose yarn',
                `<p>${intro}</p><p class="summary" style="margin: 0.6em 0; padding-left: 1em; line-height: 1.6;">${listHtml || 'No yarn list on file.'}</p>${hasMore ? `<p class="summary">Reply with <strong>load more</strong> for more options.</p>` : ''}<p class="summary" style="margin-top: 0.8em;">Reply with the <strong>number or name</strong> of the yarn to add, or <strong>load more</strong> for more.</p>`
              );
              return {
                html,
                orderWizardPrompt: 'choose_yarn_from_supplier',
                placeOrderContext: { supplierId: best.id, supplierName: best.brandName, yarnNames: displayYarnNames, page: 1 }
              };
            }
            const matchingSuppliers = [{ id: best.id, brandName: best.brandName }];
            const html = `<p>No supplier found matching "<strong>${query}</strong>". Did you mean <strong>${best.brandName}</strong>?</p><p>Click below to order from ${best.brandName}, or try a different name.</p>`;
            return {
              html,
              orderWizardPrompt: 'disambiguate_supplier',
              matchingSuppliers
            };
          }
          const gptChoice = await interpretSupplierChoiceWithGPT(supplierQuery.trim(), allSuppliers);
          if (gptChoice?.supplierNumber) {
            const one = allSuppliers[gptChoice.supplierNumber - 1];
            if (one) {
              const id = one._id?.toString?.() || one.id;
              const brandName = one.brandName || one.name || 'Unknown';
              const supplier = await supplierService.getSupplierById(id);
              let yarnNames = supplier?.yarnDetails?.length
                ? [...new Set((supplier.yarnDetails || []).map((d) => (d.yarnName || (d.yarnType && d.yarnType.name) || '').trim()).filter(Boolean))]
                : [];
              let displayYarnNames = yarnNames;
              let filterLabel = '';
              let noColourMatchMessage = '';
              if (yarnHint && String(yarnHint).trim()) {
                const h = String(yarnHint).trim().toLowerCase();
                const matching = yarnNames.filter((y) => y.toLowerCase().includes(h));
                if (matching.length > 0) {
                  displayYarnNames = matching;
                  filterLabel = ` with "<strong>${yarnHint}</strong>" in the name`;
                } else {
                  noColourMatchMessage = `This supplier has nothing in <strong>${yarnHint}</strong>. You can: <strong>change supplier</strong>, <strong>look for another colour</strong>, or <strong>choose from the table below</strong>.`;
                }
              }
              const pageSize = 5;
              const slice = displayYarnNames.slice(0, pageSize);
              const hasMore = displayYarnNames.length > pageSize;
              const listHtml = slice.map((y, i) => `${i + 1}. ${y}`).join('<br/>');
              const intro = noColourMatchMessage
                ? `<p>${noColourMatchMessage}</p><p>Here are yarn items from <strong>${brandName}</strong> (top ${slice.length}):</p>`
                : filterLabel
                  ? `Here are yarn items from <strong>${brandName}</strong>${filterLabel}:`
                  : `You chose <strong>${brandName}</strong>. Here are yarn items (top ${slice.length}):`;
              const html = generateHTMLResponse(
                'Choose yarn',
                `<p>${intro}</p><p class="summary" style="margin: 0.6em 0; padding-left: 1em; line-height: 1.6;">${listHtml || 'No yarn list on file.'}</p>${hasMore ? `<p class="summary">Reply with <strong>load more</strong> for more options.</p>` : ''}<p class="summary" style="margin-top: 0.8em;">Reply with the <strong>number or name</strong> of the yarn to add, or <strong>load more</strong> for more.</p>`
              );
              return {
                html,
                orderWizardPrompt: 'choose_yarn_from_supplier',
                placeOrderContext: { supplierId: id, supplierName: brandName, yarnNames: displayYarnNames, page: 1 }
              };
            }
          } else if (gptChoice?.supplierQuery) {
            const nearestGpt = findNearestSupplierByTypo(gptChoice.supplierQuery, allSuppliers, { maxTotalEditDistance: 6, maxPerWord: 2 });
            if (nearestGpt && nearestGpt.score <= 2) {
              const supplier = await supplierService.getSupplierById(nearestGpt.best.id);
              let yarnNames = supplier?.yarnDetails?.length
                ? [...new Set((supplier.yarnDetails || []).map((d) => (d.yarnName || (d.yarnType && d.yarnType.name) || '').trim()).filter(Boolean))]
                : [];
              let displayYarnNames = yarnNames;
              let filterLabel = '';
              let noColourMatchMessage = '';
              if (yarnHint && String(yarnHint).trim()) {
                const h = String(yarnHint).trim().toLowerCase();
                const matching = yarnNames.filter((y) => y.toLowerCase().includes(h));
                if (matching.length > 0) {
                  displayYarnNames = matching;
                  filterLabel = ` with "<strong>${yarnHint}</strong>" in the name`;
                } else {
                  noColourMatchMessage = `This supplier has nothing in <strong>${yarnHint}</strong>. You can: <strong>change supplier</strong>, <strong>look for another colour</strong>, or <strong>choose from the table below</strong>.`;
                }
              }
              const pageSize = 5;
              const slice = displayYarnNames.slice(0, pageSize);
              const hasMore = displayYarnNames.length > pageSize;
              const listHtml = slice.map((y, i) => `${i + 1}. ${y}`).join('<br/>');
              const intro = noColourMatchMessage
                ? `<p>${noColourMatchMessage}</p><p>Here are yarn items from <strong>${nearestGpt.best.brandName}</strong> (top ${slice.length}):</p>`
                : filterLabel
                  ? `Here are yarn items from <strong>${nearestGpt.best.brandName}</strong>${filterLabel}:`
                  : `You chose <strong>${nearestGpt.best.brandName}</strong>. Here are yarn items (top ${slice.length}):`;
              const html = generateHTMLResponse(
                'Choose yarn',
                `<p>${intro}</p><p class="summary" style="margin: 0.6em 0; padding-left: 1em; line-height: 1.6;">${listHtml || 'No yarn list on file.'}</p>${hasMore ? `<p class="summary">Reply with <strong>load more</strong> for more options.</p>` : ''}<p class="summary" style="margin-top: 0.8em;">Reply with the <strong>number or name</strong> of the yarn to add, or <strong>load more</strong> for more.</p>`
              );
              return {
                html,
                orderWizardPrompt: 'choose_yarn_from_supplier',
                placeOrderContext: { supplierId: nearestGpt.best.id, supplierName: nearestGpt.best.brandName, yarnNames: displayYarnNames, page: 1 }
              };
            }
          }
          return generateHTMLResponse('Supplier not found', `No supplier found matching "${query}". Please check the name or choose from the supplier list.`);
        }
        if (matches.length === 1) {
          const one = matches[0];
          const id = one._id?.toString?.() || one.id;
          const brandName = one.brandName || one.name || 'Unknown';
          const supplier = await supplierService.getSupplierById(id);
          let yarnNames = supplier?.yarnDetails?.length
            ? [...new Set((supplier.yarnDetails || []).map((d) => (d.yarnName || (d.yarnType && d.yarnType.name) || '').trim()).filter(Boolean))]
            : [];
          let displayYarnNames = yarnNames;
          let filterLabel = '';
          let noColourMatchMessage = '';
          if (yarnHint && String(yarnHint).trim()) {
            const h = String(yarnHint).trim().toLowerCase();
            const matching = yarnNames.filter((y) => y.toLowerCase().includes(h));
            if (matching.length > 0) {
              displayYarnNames = matching;
              filterLabel = ` with "<strong>${yarnHint}</strong>" in the name`;
            } else {
              noColourMatchMessage = `This supplier has nothing in <strong>${yarnHint}</strong>. You can: <strong>change supplier</strong>, <strong>look for another colour</strong>, or <strong>choose from the table below</strong>.`;
            }
          }
          const pageSize = 5;
          const slice = displayYarnNames.slice(0, pageSize);
          const hasMore = displayYarnNames.length > pageSize;
          const listHtml = slice.map((y, i) => `${i + 1}. ${y}`).join('<br/>');
          const intro = noColourMatchMessage
            ? `<p>${noColourMatchMessage}</p><p>Here are yarn items from <strong>${brandName}</strong> (top ${slice.length}):</p>`
            : filterLabel
              ? `Here are yarn items from <strong>${brandName}</strong>${filterLabel}:`
              : `You chose <strong>${brandName}</strong>. Here are yarn items (top ${slice.length}):`;
          const html = generateHTMLResponse(
            'Choose yarn',
            `<p>${intro}</p><p class="summary" style="margin: 0.6em 0; padding-left: 1em; line-height: 1.6;">${listHtml || 'No yarn list on file.'}</p>${hasMore ? `<p class="summary">Reply with <strong>load more</strong> for more options.</p>` : ''}<p class="summary" style="margin-top: 0.8em;">Reply with the <strong>number or name</strong> of the yarn to add, or <strong>load more</strong> for more.</p>`
          );
          return {
            html,
            orderWizardPrompt: 'choose_yarn_from_supplier',
            placeOrderContext: { supplierId: id, supplierName: brandName, yarnNames: displayYarnNames, page: 1 }
          };
        }
        // Multiple suppliers matching (e.g. "Wampum") — show as numbered list, same style as initial supplier list
        const matchingSuppliers = matches.map((s) => ({
          id: s._id?.toString?.() || s.id,
          brandName: s.brandName || s.name || 'Unknown'
        }));
        const numberedList = matchingSuppliers.map((s, i) => `${i + 1}. ${s.brandName}`).join('<br/>');
        const html = generateHTMLResponse(
          'Choose supplier',
          `<p>There are <strong>${matches.length}</strong> suppliers matching "${query}". Which one do you mean?</p><p class="summary" style="margin: 0.6em 0; padding-left: 1em; line-height: 1.6;">${numberedList}</p><p class="summary" style="margin-top: 0.8em;">Reply with the <strong>number</strong> (e.g. 1 or 2) or <strong>supplier name</strong>, or click below.</p>`
        );
        return {
          html,
          orderWizardPrompt: 'disambiguate_supplier',
          matchingSuppliers
        };
      }

      // User selected a supplier from disambiguation or "see yarn list": show numbered list of yarns (same procedure as chat flow), not checkbox wizard
      if (showSupplierList && preSelectedSupplierId) {
        const selectedSupplier = await supplierService.getSupplierById(preSelectedSupplierId);
        const supplierId = selectedSupplier?._id?.toString?.() || preSelectedSupplierId;
        const brandName = selectedSupplier?.brandName || selectedSupplier?.name || 'Unknown';
        const yarnNames = selectedSupplier?.yarnDetails?.length
          ? [...new Set((selectedSupplier.yarnDetails || [])
              .map((d) => (d.yarnName || (d.yarnType && d.yarnType.name) || '').trim())
              .filter(Boolean))]
          : [];
        const pageSize = 5;
        const slice = yarnNames.slice(0, pageSize);
        const hasMore = yarnNames.length > pageSize;
        const listHtml = slice.map((y, i) => `${i + 1}. ${y}`).join('<br/>');
        const html = generateHTMLResponse(
          'Choose yarn',
          `<p>You chose <strong>${brandName}</strong>. Here are yarn items (top ${slice.length}):</p><p class="summary" style="margin: 0.6em 0; padding-left: 1em; line-height: 1.6;">${listHtml || 'No yarn list on file.'}</p>${hasMore ? `<p class="summary">Reply with <strong>load more</strong> for more options.</p>` : ''}<p class="summary" style="margin-top: 0.8em;">Reply with the <strong>number or name</strong> of the yarn to add, or <strong>load more</strong> for more.</p>`
        );
        return {
          html,
          orderWizardPrompt: 'choose_yarn_from_supplier',
          placeOrderContext: { supplierId, supplierName: brandName, yarnNames, page: 1 }
        };
      }

      // If user chose "Show supplier list" (no pre-selected), return numbered list of suppliers (same as choose_supplier / disambiguate_supplier flow)
      if (showSupplierList) {
        const suppliersResult = await supplierService.querySuppliers({}, { limit: 200, page: 1 });
        const suppliers = suppliersResult?.results ?? suppliersResult ?? [];
        const matchingSuppliers = suppliers.map((s) => ({
          id: (s._id || s.id)?.toString?.() || s.id,
          brandName: s.brandName || s.name || 'Unknown'
        }));
        const numberedList = matchingSuppliers.map((s, i) => `${i + 1}. ${s.brandName}`).join('<br/>');
        const html = generateHTMLResponse(
          'Choose supplier',
          `<p>Reply with the <strong>number</strong> (1–${matchingSuppliers.length}) or supplier name to continue:</p><p class="summary" style="margin: 0.6em 0; padding-left: 1em; line-height: 1.6;">${numberedList}</p>`
        );
        return {
          html,
          orderWizardPrompt: 'disambiguate_supplier',
          matchingSuppliers
        };
      }

      // No supplier mentioned: fetch suppliers and colours, show both lists and which supplier has which colour
      const [suppliersForListRes, colorsRes] = await Promise.all([
        supplierService.querySuppliers({}, { limit: 50 }),
        colorService.queryColors({}, { limit: 30, page: 1 })
      ]);
      const list = (suppliersForListRes?.results ?? suppliersForListRes ?? []);
      const colorList = (colorsRes?.results ?? colorsRes ?? []);
      const numberedList = list
        .map((s, i) => {
          const name = s.brandName || s.supplierName || s.name || 'N/A';
          return `${i + 1}. ${name}`;
        })
        .join('<br/>');
      const colourNames = [...new Set(colorList.map((c) => (c.name || c.pantoneName || '').trim()).filter(Boolean))].slice(0, 25);
      const colourListHtml = colourNames.length > 0
        ? colourNames.join(', ')
        : '—';
      // Build "which supplier has which colour" from each supplier's yarnDetails (embedded on paginated result)
      const supplierColoursList = [];
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        const supplierName = s.brandName || s.supplierName || s.name || 'N/A';
        const yarnDetails = s.yarnDetails || [];
        const yarnNamesForSupplier = yarnDetails.map((d) => (d.yarnName || (d.yarnType && d.yarnType.name) || '').trim()).filter(Boolean);
        const hasColours = [];
        for (const col of colourNames) {
          const colLower = col.toLowerCase();
          if (yarnNamesForSupplier.some((yn) => yn.toLowerCase().includes(colLower))) hasColours.push(col);
        }
        if (hasColours.length > 0) {
          supplierColoursList.push(`${i + 1}. <strong>${supplierName}</strong> — ${hasColours.slice(0, 15).join(', ')}${hasColours.length > 15 ? ` (+${hasColours.length - 15} more)` : ''}`);
        }
      }
      const whichSupplierWhichColourHtml = supplierColoursList.length > 0
        ? `<p><strong>Which supplier has which colour</strong> (in yarn name):</p><p class="summary" style="margin: 0.6em 0; padding-left: 1em; line-height: 1.5;">${supplierColoursList.join('<br/>')}</p>`
        : '';
      let chooseSupplierHtml = '';
      if (list.length > 0) {
        chooseSupplierHtml = `<p>To place a yarn purchase order, choose a <strong>supplier</strong> and optionally a <strong>colour</strong>.</p>
<p><strong>Suppliers</strong> — reply with the number or name:</p><p class="summary" style="margin: 0.6em 0; padding-left: 1em; line-height: 1.6;">${numberedList}</p>
${whichSupplierWhichColourHtml}
<p><strong>Colours you can search for</strong> (e.g. in yarn name):</p><p class="summary" style="margin: 0.6em 0; padding-left: 1em;">${colourListHtml}</p>
<p class="summary" style="margin-top: 0.6em;">Or type your supplier name, or e.g. <strong>buy yarn from [supplier] in [colour]</strong>.</p>`;
      } else {
        chooseSupplierHtml = '<p>To place a yarn purchase order, I need the supplier. No suppliers found in the system — add suppliers in Yarn Management first.</p>';
      }
      return {
        html: chooseSupplierHtml,
        orderWizardPrompt: 'choose_supplier'
      };
    }
    let supplier = null;
    if (supplierId) {
      supplier = await supplierService.getSupplierById(supplierId);
    } else {
      const result = await supplierService.querySuppliers({ brandName: supplierName }, { limit: 1 });
      supplier = result?.results?.[0] || result?.[0] || null;
    }
    if (!supplier) {
      return generateHTMLResponse('Create Order Failed', `Supplier not found: "${supplierName || supplierId}". Please use an existing supplier name.`);
    }
    const supplierObjId = supplier._id?.toString?.() || supplier.id;
    const supplierYarnNames = (supplier.yarnDetails || [])
      .map((d) => (d.yarnName || (d.yarnType && d.yarnType.name) || '').trim())
      .filter(Boolean);
    const items = Array.isArray(rawItems) ? rawItems : (rawItems && typeof rawItems === 'object' ? [rawItems] : []);
    if (items.length === 0) {
      return generateHTMLResponse('Create Order Failed', 'At least one PO item is required (yarn name, quantity, rate).');
    }
    const poItems = [];
    let subTotal = 0;
    let gstTotal = 0;
    for (const it of items) {
      const yarnName = (it.yarnName || it.yarn_name || it.name || '').trim();
      const quantity = Number(it.quantity ?? it.qty ?? 0);
      const rate = Number(it.rate ?? 0);
      const sizeCount = (it.sizeCount || it.size_count || it.count || '').trim() || '-';
      const shadeCode = (it.shadeCode || it.shade_code || it.shade || '').trim() || '';
      const gstRate = Number(it.gstRate ?? it.gst_rate ?? 0);
      if (!yarnName || quantity <= 0 || rate <= 0) continue;
      if (supplierYarnNames.length > 0) {
        const supplierHasYarn = supplierYarnNames.some((s) => s.toLowerCase().trim() === yarnName.toLowerCase().trim());
        if (!supplierHasYarn) {
          return generateHTMLResponse('Create Order Failed', `Supplier "${supplier.brandName || supplierName}" does not list yarn "${yarnName}". Choose a yarn from their catalog.`);
        }
      }
      const catalogList = await yarnCatalogService.queryYarnCatalogs({ yarnName }, { limit: 1 });
      const yarnCatalog = catalogList?.results?.[0] || catalogList?.[0] || null;
      if (!yarnCatalog) {
        return generateHTMLResponse('Create Order Failed', `Yarn not found in catalog: "${yarnName}". Add the yarn to the catalog first.`);
      }
      const yarnId = yarnCatalog._id?.toString?.() || yarnCatalog.id;
      const lineTotal = rate * quantity;
      const lineGst = gstRate ? (lineTotal * gstRate) / 100 : 0;
      subTotal += lineTotal;
      gstTotal += lineGst;
      poItems.push({
        yarn: yarnId,
        yarnName: yarnCatalog.yarnName || yarnName,
        sizeCount,
        shadeCode: shadeCode || undefined,
        rate,
        quantity,
        gstRate: gstRate || undefined,
        estimatedDeliveryDate: it.estimatedDeliveryDate ? new Date(it.estimatedDeliveryDate) : undefined,
      });
    }
    if (poItems.length === 0) {
      return generateHTMLResponse('Create Order Failed', 'No valid items (yarn name, quantity > 0, rate > 0).');
    }
    const total = subTotal + gstTotal;
    const body = {
      poNumber: String(poNumber).trim(),
      supplierName: supplier.brandName || supplierName,
      supplier: supplierObjId,
      poItems,
      notes: notes || undefined,
      subTotal,
      gst: gstTotal,
      total,
      currentStatus: 'submitted_to_supplier',
    };
    const created = await yarnPurchaseOrderService.createPurchaseOrder(body);
    const msg = `Purchase order <strong>${created.poNumber}</strong> created successfully with ${poItems.length} item(s). Total: ₹${total.toLocaleString()}.`;
    return generateHTMLResponse('Order Placed', msg);
  } catch (error) {
    console.error('Error in createYarnPurchaseOrder:', error);
    return generateHTMLResponse('Error', `Failed to create purchase order: ${error.message}`);
  }
};

/**
 * Build HTML for a single purchase order (shared by get and edit).
 * Supplier name shown here is the same source used in the edit flow (add item, list yarn from supplier).
 */
const buildOrderDetailsHtml = (order) => {
  const supplierName = order.supplier?.brandName || (typeof order.supplier === 'string' ? order.supplier : 'N/A');
  const status = order.currentStatus || order.status || 'N/A';
  const items = (order.poItems || []).map((item) => {
    const yarnName = item.yarnName || (item.yarn?.yarnName) || 'N/A';
    const rate = item.rate ?? 0;
    const qty = item.quantity ?? 0;
    const lineTotal = rate * qty;
    return `<tr><td>${yarnName}</td><td>${item.sizeCount || '-'}</td><td>${item.shadeCode || '-'}</td><td>${rate}</td><td>${qty}</td><td>₹${lineTotal.toLocaleString()}</td></tr>`;
  }).join('');
  return AI_TOOL_STYLES + `
    <div class="ai-tool-response">
      <h3>🛒 Purchase Order: ${order.poNumber || 'N/A'}</h3>
      <div class="kpi-grid">
        <div class="kpi-item"><div class="kpi-label">Supplier</div><div class="kpi-value">${supplierName}</div></div>
        <div class="kpi-item"><div class="kpi-label">Status</div><div class="kpi-value">${status.replace(/_/g, ' ')}</div></div>
        <div class="kpi-item"><div class="kpi-label">Total</div><div class="kpi-value">₹${(order.total ?? order.totalAmount ?? 0).toLocaleString()}</div></div>
      </div>
      <div class="table-container">
        <table class="data-table">
          <thead><tr><th>Yarn</th><th>Count</th><th>Shade</th><th>Rate</th><th>Qty</th><th>Line Total</th></tr></thead>
          <tbody>${items}</tbody>
        </table>
      </div>
      <p class="summary">PO ${order.poNumber || ''} — ${order.poItems?.length || 0} item(s).</p>
    </div>`;
};

/**
 * Four separate PO flows (do not merge; may share helpers but must not conflict):
 * 1. Create PO: createYarnPurchaseOrder — placeOrderContext; new order, supplier, yarn, place.
 * 2. Edit/Update PO: editYarnPurchaseOrder + applyYarnPurchaseOrderEdit — editOrderContext; items, qty, add, remove only (not status).
 * 3. Update status PO: updateYarnPurchaseOrderStatus — orderRefForStatus, awaitingFollowUp; status only.
 * 4. Delete PO: deleteYarnPurchaseOrder — no persistent context.
 */

/**
 * Edit yarn purchase order — show order and enable in-chat editing. Returns editOrderContext so next messages apply edits.
 * @param {Object} params - { purchaseOrderId or poNumber }
 * @returns {Promise<{ html: string, editOrderContext?: { purchaseOrderId: string, poNumber: string } }>}
 */
export const editYarnPurchaseOrder = async (params = {}) => {
  const p = params && typeof params === 'object' ? params : {};
  const idOrPo = p.purchaseOrderId || p.poNumber || p.orderId;
  if (!idOrPo) {
    return generateHTMLResponse('Edit Order', 'Please specify which order to edit (e.g. "edit order PO-2026-966" or "update order PO-2026-968").');
  }
  const purchaseOrderId = await resolvePurchaseOrderId(idOrPo);
  if (!purchaseOrderId) {
    return generateHTMLResponse('Order Not Found', `No purchase order found for "${idOrPo}".`);
  }
  const order = await yarnPurchaseOrderService.getPurchaseOrderById(purchaseOrderId);
  if (!order) {
    return generateHTMLResponse('Order Not Found', `No purchase order found for "${idOrPo}".`);
  }
  const baseHtml = buildOrderDetailsHtml(order);
  const editNote = `
    <p class="summary" style="margin-top: 0.8em;"><strong>✏️ What would you like to edit?</strong></p>
    <p class="summary" style="margin: 0.4em 0;">You can change any of these:</p>
    <ul class="summary" style="margin: 0.4em 0; padding-left: 1.4em;">
      <li><strong>Quantity</strong> — e.g. "set quantity of [yarn name] to 60" or "quantity to 50" (first item)</li>
      <li><strong>Add item</strong> — e.g. "add [yarn name] 20 at 100"</li>
      <li><strong>Remove item</strong> — e.g. "remove [yarn name]"</li>
    </ul>
    <p class="summary" style="margin: 0.6em 0;">Reply with the change you want. After each edit I'll ask if you want to <strong>edit more</strong> or <strong>complete the order</strong>. To change status, use <strong>update status</strong> from the main menu.</p>`;
  return {
    html: baseHtml + editNote,
    editOrderContext: { purchaseOrderId: order._id.toString(), poNumber: order.poNumber }
  };
};

/**
 * Resolve PO number to edit context (for FAQ fallback when client did not send editOrderPo).
 * Order is fetched by PO number and has supplier populated; edit flow then uses that supplier to fetch its yarn list.
 * @param {string} poNumber - e.g. "PO-2026-975"
 * @returns {Promise<{ purchaseOrderId: string, poNumber: string } | null>}
 */
export const getEditOrderContextFromPoNumber = async (poNumber) => {
  if (!poNumber || typeof poNumber !== 'string' || !poNumber.trim()) return null;
  const purchaseOrderId = await resolvePurchaseOrderId(poNumber.trim());
  if (!purchaseOrderId) return null;
  const order = await yarnPurchaseOrderService.getPurchaseOrderById(purchaseOrderId);
  if (!order || !order.poNumber) return null;
  return { purchaseOrderId: order._id.toString(), poNumber: order.poNumber };
};

/** Status options for "choose status" flow (number + code + label) */
const STATUS_OPTIONS = [
  { code: 'submitted_to_supplier', label: 'Submitted to supplier' },
  { code: 'in_transit', label: 'In transit' },
  { code: 'goods_received', label: 'Goods received' },
  { code: 'goods_partially_received', label: 'Goods partially received' },
  { code: 'qc_pending', label: 'QC pending' },
  { code: 'po_rejected', label: 'PO rejected' },
  { code: 'po_accepted', label: 'PO accepted' },
  { code: 'po_accepted_partially', label: 'PO accepted partially' },
];

/** Get status option by 1-based number (1–8) for follow-up flow */
export const getStatusOptionByNumber = (num) => {
  const n = parseInt(String(num).trim(), 10);
  if (Number.isNaN(n) || n < 1 || n > STATUS_OPTIONS.length) return null;
  return STATUS_OPTIONS[n - 1] || null;
};

/** Get status option by 1-based number from list that excludes current order status (so user can't "change" to same status) */
export const getStatusOptionByNumberExcluding = (num, excludeStatusCode) => {
  const n = parseInt(String(num).trim(), 10);
  const available = excludeStatusCode
    ? STATUS_OPTIONS.filter((s) => s.code !== String(excludeStatusCode).trim())
    : STATUS_OPTIONS;
  if (Number.isNaN(n) || n < 1 || n > available.length) return null;
  return available[n - 1] || null;
};

/** Reject LLM placeholder/schema text (e.g. "extracted ... or null") so we don't show confirmation with fake status */
const isValidStatusForConfirmation = (value) => {
  if (value == null || typeof value !== 'string') return false;
  const s = value.trim();
  if (s.length > 60) return false;
  const placeholderPatterns = [/extracted/i, /\bor null\b/i, /\be\.g\.\s/i, /when updating/i];
  if (placeholderPatterns.some((re) => re.test(s))) return false;
  const code = s.replace(/\s+/g, '_').toLowerCase();
  return STATUS_OPTIONS.some((opt) => opt.code === code || opt.label.toLowerCase() === s.toLowerCase());
};

/**
 * Build response asking user to choose status by number. Excludes current order status so user can't "change" to same.
 * @param {string} idOrPo - PO number or order ID
 * @param {string} [currentStatusCode] - order's current status code (e.g. submitted_to_supplier); this option is omitted from the list
 * @returns {Object} { html, needsStatusChoice: true, orderRef }
 */
const buildChooseStatusResponse = (idOrPo, currentStatusCode) => {
  const orderRef = /^[a-f0-9]{24}$/i.test(String(idOrPo).trim()) ? { purchaseOrderId: idOrPo } : { poNumber: idOrPo };
  const currentCode = currentStatusCode ? String(currentStatusCode).trim() : null;
  const available = currentCode ? STATUS_OPTIONS.filter((s) => s.code !== currentCode) : STATUS_OPTIONS;
  const currentLabel = currentCode ? (STATUS_OPTIONS.find((s) => s.code === currentCode)?.label || currentCode.replace(/_/g, ' ')) : null;
  if (available.length === 0) {
    const html = generateHTMLResponse('Update Status', `Order <strong>${idOrPo}</strong> is already the only status. Nothing to change.`);
    return { html, needsStatusChoice: false, orderRef };
  }
  const listItems = available.map((s, i) => `${i + 1}. ${s.label} (<code>${s.code}</code>)`).join('<br/>');
  const currentLine = currentLabel
    ? `<p class="summary" style="margin: 0.4em 0;"><strong>Current status:</strong> ${currentLabel}. Choose a <strong>different</strong> status:</p>`
    : '<p class="summary" style="margin: 0.4em 0;">Reply with the <strong>number</strong> of the new status:</p>';
  const html = generateHTMLResponse(
    'Choose status',
    `<p>To which status do you want to update order <strong>${idOrPo}</strong>?</p>
    ${currentLine}
    <p class="summary" style="margin: 0.4em 0; padding-left: 1em;">${listItems}</p>
    <p class="summary" style="margin-top: 0.8em;">After you choose, I'll ask you to confirm before updating.</p>`
  );
  const orderRefWithCurrent = { ...orderRef, ...(currentCode && { currentStatus: currentCode }) };
  return { html, needsStatusChoice: true, orderRef: orderRefWithCurrent };
};

/**
 * Update yarn purchase order status (for agent)
 * @param {Object} params - { purchaseOrderId or poNumber, status_code }
 * @returns {Promise<string>} HTML
 */
export const updateYarnPurchaseOrderStatus = async (params = {}) => {
  try {
    const p = params && typeof params === 'object' ? params : {};
    const idOrPo = p.purchaseOrderId || p.poNumber || p.orderId;
    const statusCode = p.status_code || p.status;
    if (!idOrPo) {
      return generateHTMLResponse('Update Status', 'Please specify which order (e.g. PO-2026-965). I\'ll then ask you to choose the new status from a list.');
    }
    const purchaseOrderId = await resolvePurchaseOrderId(idOrPo);
    if (!purchaseOrderId) {
      return generateHTMLResponse('Order Not Found', `No purchase order found for "${idOrPo}".`);
    }
    if (!statusCode || !isValidStatusForConfirmation(statusCode)) {
      const order = await yarnPurchaseOrderService.getPurchaseOrderById(purchaseOrderId);
      const currentStatus = order?.currentStatus || null;
      return buildChooseStatusResponse(idOrPo, currentStatus);
    }
    const statusMap = {
      'submitted to supplier': 'submitted_to_supplier',
      'in transit': 'in_transit',
      'goods received': 'goods_received',
      'qc pending': 'qc_pending',
      'po accepted': 'po_accepted',
      'po rejected': 'po_rejected',
      'goods partially received': 'goods_partially_received',
      'po accepted partially': 'po_accepted_partially',
    };
    const code = (statusMap[String(statusCode).toLowerCase().replace(/\s+/g, ' ')] || String(statusCode).replace(/\s+/g, '_')).toLowerCase();
    const validStatuses = STATUS_OPTIONS.map((s) => s.code);
    const finalCode = validStatuses.find((s) => s.replace(/_/g, ' ') === code.replace(/_/g, ' ')) || (validStatuses.includes(code) ? code : null);
    if (!finalCode) {
      return generateHTMLResponse('Invalid Status', `Valid statuses: ${validStatuses.join(', ')}`);
    }
    const mongoose = await import('mongoose');
    await yarnPurchaseOrderService.updatePurchaseOrderStatus(
      purchaseOrderId,
      finalCode,
      { username: 'agent', user_id: new mongoose.default.Types.ObjectId().toString() },
      null
    );
    return generateHTMLResponse('Status Updated', `Purchase order "${idOrPo}" status set to <strong>${finalCode.replace(/_/g, ' ')}</strong>.`);
  } catch (error) {
    console.error('Error in updateYarnPurchaseOrderStatus:', error);
    return generateHTMLResponse('Error', `Failed to update status: ${error.message}`);
  }
};

/**
 * Delete yarn purchase order (for agent)
 * @param {Object} params - { purchaseOrderId or poNumber }
 * @returns {Promise<string>} HTML
 */
export const deleteYarnPurchaseOrder = async (params = {}) => {
  try {
    const p = params && typeof params === 'object' ? params : {};
    const idOrPo = p.purchaseOrderId || p.poNumber || p.orderId;
    if (!idOrPo) {
      return generateHTMLResponse('Delete Order', 'Please specify order ID or PO number to delete (e.g. "delete order PO-2024-001").');
    }
    const purchaseOrderId = await resolvePurchaseOrderId(idOrPo);
    if (!purchaseOrderId) {
      return generateHTMLResponse('Order Not Found', `No purchase order found for "${idOrPo}".`);
    }
    await yarnPurchaseOrderService.deletePurchaseOrderById(purchaseOrderId);
    return generateHTMLResponse('Order Deleted', `Purchase order "${idOrPo}" has been deleted.`);
  } catch (error) {
    console.error('Error in deleteYarnPurchaseOrder:', error);
    return generateHTMLResponse('Error', `Failed to delete purchase order: ${error.message}`);
  }
};

/** Prompt shown after each edit: ask if user wants to edit more or complete the order */
const EDIT_MORE_OR_COMPLETE_PROMPT = `
    <p class="summary" style="margin-top: 1em; padding: 0.6em; background: rgba(59, 130, 246, 0.1); border-radius: 8px;">
      <strong>What would you like to do?</strong><br/>
      • <strong>Edit more</strong> — reply with another change (quantity, add item, or remove item)<br/>
      • <strong>Complete order</strong> — say <strong>complete</strong> or <strong>done</strong> to finish editing
    </p>`;

/** Recompute order totals from poItems */
const recomputeOrderTotals = (poItems) => {
  let subTotal = 0;
  let gstTotal = 0;
  for (const it of poItems) {
    const lineTotal = (it.rate ?? 0) * (it.quantity ?? 0);
    subTotal += lineTotal;
    gstTotal += (it.gstRate ? (lineTotal * it.gstRate) / 100 : 0);
  }
  return { subTotal, gst: gstTotal, total: subTotal + gstTotal };
};

const EDIT_ADD_ITEM_PAGE_SIZE = 5;

/**
 * Apply in-chat EDIT flow only (quantity, add/remove item). Does NOT handle status or delete — those are separate flows.
 * Called when context.editOrderPo is set. Status/delete intents are routed to updateYarnPurchaseOrderStatus / deleteYarnPurchaseOrder by the FAQ layer.
 * @param {string} purchaseOrderId - Mongo ID
 * @param {string} userMessage - User's edit instruction
 * @param {Object} [editContext] - Previous editOrderContext (may contain addItemState for "add item" sub-flow)
 * @returns {Promise<{ html: string, editOrderContext?: { purchaseOrderId: string, poNumber: string, addItemState?: Object } | null }>}
 */
export const applyYarnPurchaseOrderEdit = async (purchaseOrderId, userMessage, editContext = null) => {
  const rawMsg = String(userMessage).trim();
  const msg = rawMsg.toLowerCase();
  // Order fetched by ID (or resolved from PO number) always has supplier populated; use that supplier to fetch its yarn list for add-item flows
  const order = await yarnPurchaseOrderService.getPurchaseOrderById(purchaseOrderId);
  if (!order) {
    return { html: generateHTMLResponse('Error', 'Order not found.'), editOrderContext: null };
  }
  const poNumber = order.poNumber;
  const items = order.poItems || [];
  const orderSupplierId = order.supplier?._id || order.supplier;

  if (/^(done|cancel|exit|stop|complete)\s*(edit(ing)?|order)?$/.test(msg) || /cancel\s*edit/.test(msg) || /complete\s*(the\s+)?order/.test(msg)) {
    const isComplete = /complete|done|finish/.test(msg);
    return {
      html: generateHTMLResponse(
        isComplete ? 'Order Complete' : 'Edit Cancelled',
        isComplete
          ? `Order <strong>${poNumber}</strong> edits are complete. Say "edit order PO-xxx" anytime to edit again.`
          : `Stopped editing ${poNumber}. You can say "edit order PO-xxx" again to edit another order.`
      ),
      editOrderContext: null
    };
  }

  const getYarnName = (item) => (item.yarnName || (item.yarn?.yarnName) || '').toLowerCase();

  // When context lost but user asked colour/keyword in add-item context (e.g. "do you have anything in blue") — load order's supplier yarn list and search, so we don't route to raw materials
  const addItemState = editContext?.addItemState;
  const questionKeywordPattern = /^(?:do\s+you\s+have\s+(?:anything\s+in\s+|something\s+in\s+)?|do\s+they\s+(?:have\s+)?(?:anything\s+in\s+|something\s+in\s+)|does\s+this\s+supplier\s+(?:have|has)\s+(?:anything\s+in\s+|something\s+in\s+)?|anything\s+in\s+|something\s+in\s+|any\s+|show\s+me\s+(?:some\s+)?|got\s+any\s+|what\s+about\s+(?:in\s+)?|look\s+for\s+|another\s+colou?r\s+)(.+)$/i;
  const questionKeywordMatchNoContext = !addItemState?.yarnNames && rawMsg.match(questionKeywordPattern);
  if (questionKeywordMatchNoContext && orderSupplierId && questionKeywordMatchNoContext[1]) {
    let questionKeyword = questionKeywordMatchNoContext[1].replace(/\s*yarn\s*$/i, '').trim();
    if (questionKeyword && /^something\s+/i.test(questionKeyword)) questionKeyword = questionKeyword.replace(/^something\s+/i, '').trim();
    if (questionKeyword && /\b(?:anything|something)\s+in\s+/i.test(questionKeyword)) questionKeyword = questionKeyword.replace(/^(?:anything|something)\s+in\s+/i, '').trim();
    if (questionKeyword && questionKeyword.length >= 2) {
      try {
        const supplier = await supplierService.getSupplierById(orderSupplierId);
        const supplierNameFromOrder = order.supplier?.brandName || (typeof order.supplier === 'string' ? order.supplier : null);
        const supplierName = supplierNameFromOrder || supplier?.brandName || 'this supplier';
        const yarnDetails = supplier?.yarnDetails || [];
        const yarnNames = [...new Set((yarnDetails || []).map((d) => (d.yarnName || (d.yarnType && d.yarnType.name) || '').trim()).filter(Boolean))];
        if (yarnNames.length > 0) {
          let searchKeyword = questionKeyword;
          const availableTerms = extractTermsFromYarnNames(yarnNames);
          if (availableTerms.length > 0) {
            try {
              const corrected = await suggestYarnKeywordCorrection(questionKeyword, availableTerms);
              if (corrected && corrected.toLowerCase() !== questionKeyword.toLowerCase()) searchKeyword = corrected;
            } catch (e) { /* use original */ }
          }
          const kwLower = searchKeyword.toLowerCase();
          const matchesInList = yarnNames.filter((y) => y.toLowerCase().includes(kwLower));
          if (matchesInList.length === 1) {
            const chosenYarnName = matchesInList[0];
            const html = generateHTMLResponse('Add item', `<p>You chose <strong>${chosenYarnName}</strong>. How many units do you want to add?</p><p class="summary">Reply with a number (e.g. 20 or 50).</p>`) + buildOrderDetailsHtml(order) + EDIT_MORE_OR_COMPLETE_PROMPT;
            const newAddItemState = { step: 'quantity', chosenYarnName, yarnNames, page: 1, supplierId: orderSupplierId.toString?.() || orderSupplierId, supplierName, searchMatches: null };
            return { html, editOrderContext: { purchaseOrderId, poNumber, addItemState: newAddItemState } };
          }
          if (matchesInList.length > 1) {
            const listHtml = matchesInList.map((y, i) => `${i + 1}. ${y}`).join('<br/>');
            const html = generateHTMLResponse('Add item', `<p>Here are yarns from <strong>${supplierName}</strong> with "<strong>${searchKeyword}</strong>" in the name. Reply with the <strong>number</strong> (1–${matchesInList.length}):</p><p class="summary" style="margin: 0.6em 0; padding-left: 1em; line-height: 1.6;">${listHtml}</p>`) + buildOrderDetailsHtml(order) + EDIT_MORE_OR_COMPLETE_PROMPT;
            const newAddItemState = { step: 'choose_yarn', yarnNames, page: 1, supplierId: orderSupplierId.toString?.() || orderSupplierId, supplierName, searchMatches: matchesInList };
            return { html, editOrderContext: { purchaseOrderId, poNumber, addItemState: newAddItemState } };
          }
          const pageSize = EDIT_ADD_ITEM_PAGE_SIZE;
          const slice = yarnNames.slice(0, pageSize);
          const hasMore = yarnNames.length > pageSize;
          const listHtml = slice.map((y, i) => `${i + 1}. ${y}`).join('<br/>');
          const noMatchHtml = generateHTMLResponse('Add item', `<p>No yarn found with "<strong>${searchKeyword}</strong>" in the name from <strong>${supplierName}</strong>. Try a different keyword or pick from the list by number.</p><p class="summary" style="margin: 0.6em 0; padding-left: 1em; line-height: 1.6;">${listHtml || 'No yarn list.'}</p>${hasMore ? `<p class="summary">Reply with <strong>load more</strong> for more options.</p>` : ''}<p class="summary" style="margin-top: 0.8em;">Reply with the <strong>number</strong>, <strong>name</strong>, or <strong>keyword</strong> to add.</p>`) + buildOrderDetailsHtml(order) + EDIT_MORE_OR_COMPLETE_PROMPT;
          const newAddItemState = { step: 'choose_yarn', yarnNames, page: 1, supplierId: orderSupplierId.toString?.() || orderSupplierId, supplierName, searchMatches: null };
          return { html: noMatchHtml, editOrderContext: { purchaseOrderId, poNumber, addItemState: newAddItemState } };
        }
      } catch (e) {
        console.warn('Edit add-item keyword search (no addItemState) failed:', e?.message);
      }
    }
  }

  // "Add item" sub-flow: user chose to add item and we're collecting yarn choice, then quantity, then rate
  if (addItemState && addItemState.yarnNames && Array.isArray(addItemState.yarnNames)) {
    const yarnNames = addItemState.yarnNames;
    const supplierName = addItemState.supplierName || 'this supplier';
    const page = Math.max(1, addItemState.page || 1);
    const pageSize = EDIT_ADD_ITEM_PAGE_SIZE;
    const start = (page - 1) * pageSize;
    const slice = yarnNames.slice(start, start + pageSize);
    const hasMore = start + pageSize < yarnNames.length;

    // "done" / "cancel" in add-item flow -> exit to edit menu
    if (/^(done|cancel|back|never mind)\s*$/i.test(rawMsg)) {
      const html = generateHTMLResponse('Add item cancelled', `<p>Back to editing order <strong>${poNumber}</strong>. What would you like to do?</p>`) + buildOrderDetailsHtml(order) + EDIT_MORE_OR_COMPLETE_PROMPT;
      return { html, editOrderContext: { purchaseOrderId, poNumber } };
    }

    if (addItemState.step === 'choose_yarn') {
      // "load more" -> show next page
      if (/^\s*load\s+more\s*$/i.test(rawMsg)) {
        const nextPage = page + 1;
        const nextStart = (nextPage - 1) * pageSize;
        const nextSlice = yarnNames.slice(nextStart, nextStart + pageSize);
        const nextHasMore = nextStart + pageSize < yarnNames.length;
        const listHtml = nextSlice.map((y, i) => `${nextStart + i + 1}. ${y}`).join('<br/>');
        const html = generateHTMLResponse(
          'Add item',
          `<p>Here are more yarn items from <strong>${supplierName}</strong> (page ${nextPage}):</p><p class="summary" style="margin: 0.6em 0; padding-left: 1em; line-height: 1.6;">${listHtml || 'No more items.'}</p>${nextHasMore ? `<p class="summary">Reply with <strong>load more</strong> for more options.</p>` : ''}<p class="summary" style="margin-top: 0.8em;">Reply with the <strong>number</strong>, <strong>name</strong>, or <strong>keyword</strong> (e.g. blue) to add, or <strong>done</strong> to cancel.</p>`
        ) + buildOrderDetailsHtml(order) + EDIT_MORE_OR_COMPLETE_PROMPT;
        return { html, editOrderContext: { purchaseOrderId, poNumber, addItemState: { ...addItemState, page: nextPage, searchMatches: null } } };
      }
      // When we previously showed search results (e.g. "yarns matching blue"), number refers to that list
      const searchMatches = addItemState.searchMatches;
      if (searchMatches && Array.isArray(searchMatches) && searchMatches.length > 0) {
        const num = parseInt(rawMsg, 10);
        if (/^\d+$/.test(rawMsg) && !Number.isNaN(num) && num >= 1 && num <= searchMatches.length) {
          const chosenYarnName = searchMatches[num - 1];
          const html = generateHTMLResponse('Add item', `<p>You chose <strong>${chosenYarnName}</strong>. How many units do you want to add?</p><p class="summary">Reply with a number (e.g. 20 or 50).</p>`) + buildOrderDetailsHtml(order) + EDIT_MORE_OR_COMPLETE_PROMPT;
          return { html, editOrderContext: { purchaseOrderId, poNumber, addItemState: { ...addItemState, step: 'quantity', chosenYarnName, searchMatches: null } } };
        }
      }
      // List index: "1", "2", ... (into full list or current page list)
      const num = parseInt(rawMsg, 10);
      if (/^\d+$/.test(rawMsg) && !Number.isNaN(num) && num >= 1 && num <= yarnNames.length) {
        const chosenYarnName = yarnNames[num - 1];
        const html = generateHTMLResponse('Add item', `<p>You chose <strong>${chosenYarnName}</strong>. How many units do you want to add?</p><p class="summary">Reply with a number (e.g. 20 or 50).</p>`) + buildOrderDetailsHtml(order) + EDIT_MORE_OR_COMPLETE_PROMPT;
        return { html, editOrderContext: { purchaseOrderId, poNumber, addItemState: { ...addItemState, step: 'quantity', chosenYarnName, searchMatches: null } } };
      }
      // Question-style keyword search (like create PO): "do you have anything in blue", "does this supplier has anything in 20-blue", "anything in black"
      const questionKeywordMatch = rawMsg.match(/^(?:do\s+you\s+have\s+(?:anything\s+in\s+|something\s+in\s+)?|do\s+they\s+(?:have\s+)?(?:anything\s+in\s+|something\s+in\s+)|does\s+this\s+supplier\s+(?:have|has)\s+(?:anything\s+in\s+|something\s+in\s+)?|anything\s+in\s+|something\s+in\s+|any\s+|show\s+me\s+(?:some\s+)?|got\s+any\s+|what\s+about\s+(?:in\s+)?|look\s+for\s+|another\s+colou?r\s+)(.+)$/i)
        || rawMsg.match(/\b(?:anything|something)\s+in\s+([a-zA-Z0-9\s\-]+)\s*$/i);
      let questionKeyword = questionKeywordMatch && questionKeywordMatch[1] ? questionKeywordMatch[1].replace(/\s*yarn\s*$/i, '').trim() : null;
      if (questionKeyword && /^something\s+/i.test(questionKeyword)) questionKeyword = questionKeyword.replace(/^something\s+/i, '').trim();
      if (questionKeyword && /\b(?:anything|something)\s+in\s+/i.test(questionKeyword)) questionKeyword = questionKeyword.replace(/^(?:anything|something)\s+in\s+/i, '').trim();
      if (questionKeyword && questionKeyword.length >= 2) {
        let searchKeyword = questionKeyword;
        const availableTerms = extractTermsFromYarnNames(yarnNames);
        if (availableTerms.length > 0) {
          try {
            const corrected = await suggestYarnKeywordCorrection(questionKeyword, availableTerms);
            if (corrected && corrected.toLowerCase() !== questionKeyword.toLowerCase()) searchKeyword = corrected;
          } catch (e) { /* use original */ }
        }
        const kwLower = searchKeyword.toLowerCase();
        const matchesInList = yarnNames.filter((y) => y.toLowerCase().includes(kwLower));
        if (matchesInList.length === 1) {
          const chosenYarnName = matchesInList[0];
          const html = generateHTMLResponse('Add item', `<p>You chose <strong>${chosenYarnName}</strong>. How many units do you want to add?</p><p class="summary">Reply with a number (e.g. 20 or 50).</p>`) + buildOrderDetailsHtml(order) + EDIT_MORE_OR_COMPLETE_PROMPT;
          return { html, editOrderContext: { purchaseOrderId, poNumber, addItemState: { ...addItemState, step: 'quantity', chosenYarnName, searchMatches: null } } };
        }
        if (matchesInList.length > 1) {
          const listHtml = matchesInList.map((y, i) => `${i + 1}. ${y}`).join('<br/>');
          const html = generateHTMLResponse('Add item', `<p>Here are yarns from <strong>${supplierName}</strong> with "<strong>${searchKeyword}</strong>" in the name. Reply with the <strong>number</strong> (1–${matchesInList.length}):</p><p class="summary" style="margin: 0.6em 0; padding-left: 1em; line-height: 1.6;">${listHtml}</p>`) + buildOrderDetailsHtml(order) + EDIT_MORE_OR_COMPLETE_PROMPT;
          return { html, editOrderContext: { purchaseOrderId, poNumber, addItemState: { ...addItemState, searchMatches: matchesInList } } };
        }
        const listHtml = slice.map((y, i) => `${start + i + 1}. ${y}`).join('<br/>');
        const noMatchHtml = generateHTMLResponse('Add item', `<p>No yarn found with "<strong>${searchKeyword}</strong>" in the name. Try a different keyword or pick from the list by number.</p><p class="summary" style="margin: 0.6em 0; padding-left: 1em; line-height: 1.6;">${listHtml || 'No yarn list.'}</p>${hasMore ? `<p class="summary">Reply with <strong>load more</strong> for more options.</p>` : ''}<p class="summary" style="margin-top: 0.8em;">Reply with the <strong>number or name</strong> of the yarn to add.</p>`) + buildOrderDetailsHtml(order) + EDIT_MORE_OR_COMPLETE_PROMPT;
        return { html: noMatchHtml, editOrderContext: { purchaseOrderId, poNumber, addItemState: { ...addItemState, searchMatches: null } } };
      }
      // GPT fallback (same as create PO): interpret natural language — e.g. "does this supplier has anything in 20-blue" -> search_keyword "20-blue", then filter and show list
      try {
        const interpreted = await interpretPlaceOrderChatMessage(rawMsg, {
          yarnNames,
          supplierName,
          collectingStep: 'choose_yarn',
          collectingYarnName: addItemState.chosenYarnName
        });
        if (interpreted?.action === 'list_index' && !Number.isNaN(interpreted.value) && interpreted.value >= 1 && interpreted.value <= yarnNames.length) {
          const chosenYarnName = yarnNames[interpreted.value - 1];
          const html = generateHTMLResponse('Add item', `<p>You chose <strong>${chosenYarnName}</strong>. How many units do you want to add?</p><p class="summary">Reply with a number (e.g. 20 or 50).</p>`) + buildOrderDetailsHtml(order) + EDIT_MORE_OR_COMPLETE_PROMPT;
          return { html, editOrderContext: { purchaseOrderId, poNumber, addItemState: { ...addItemState, step: 'quantity', chosenYarnName, searchMatches: null } } };
        }
        if (interpreted?.action === 'search_keyword' && interpreted.value) {
          const kw = String(interpreted.value).trim().toLowerCase();
          if (kw.length >= 1) {
            const gptMatches = yarnNames.filter((y) => y.toLowerCase().includes(kw));
            if (gptMatches.length === 1) {
              const chosenYarnName = gptMatches[0];
              const html = generateHTMLResponse('Add item', `<p>You chose <strong>${chosenYarnName}</strong>. How many units do you want to add?</p><p class="summary">Reply with a number (e.g. 20 or 50).</p>`) + buildOrderDetailsHtml(order) + EDIT_MORE_OR_COMPLETE_PROMPT;
              return { html, editOrderContext: { purchaseOrderId, poNumber, addItemState: { ...addItemState, step: 'quantity', chosenYarnName, searchMatches: null } } };
            }
            if (gptMatches.length > 1) {
              const listHtml = gptMatches.map((y, i) => `${i + 1}. ${y}`).join('<br/>');
              const html = generateHTMLResponse('Add item', `<p>Here are yarns from <strong>${supplierName}</strong> with "<strong>${interpreted.value}</strong>" in the name. Reply with the <strong>number</strong> (1–${gptMatches.length}):</p><p class="summary" style="margin: 0.6em 0; padding-left: 1em; line-height: 1.6;">${listHtml}</p>`) + buildOrderDetailsHtml(order) + EDIT_MORE_OR_COMPLETE_PROMPT;
              return { html, editOrderContext: { purchaseOrderId, poNumber, addItemState: { ...addItemState, searchMatches: gptMatches } } };
            }
            const listHtml = slice.map((y, i) => `${start + i + 1}. ${y}`).join('<br/>');
            const noMatchHtml = generateHTMLResponse('Add item', `<p>No yarn found with "<strong>${interpreted.value}</strong>" in the name. Try a different keyword or pick from the list by number.</p><p class="summary" style="margin: 0.6em 0; padding-left: 1em; line-height: 1.6;">${listHtml || 'No yarn list.'}</p>${hasMore ? `<p class="summary">Reply with <strong>load more</strong> for more options.</p>` : ''}<p class="summary" style="margin-top: 0.8em;">Reply with the <strong>number</strong>, <strong>name</strong>, or a <strong>keyword</strong> (e.g. blue, black, nylon) to add.</p>`) + buildOrderDetailsHtml(order) + EDIT_MORE_OR_COMPLETE_PROMPT;
            return { html: noMatchHtml, editOrderContext: { purchaseOrderId, poNumber, addItemState: { ...addItemState, searchMatches: null } } };
          }
        }
      } catch (e) {
        // ignore GPT errors, fall through to yarn name match / no match
      }
      // Multi-word keyword search: "light blue", "dark grey" (words that aren't a full yarn name)
      const nameLower = rawMsg.toLowerCase();
      const stopwords = new Set(['anything', 'something', 'the', 'a', 'an', 'in', 'with', 'for', 'and', 'or', 'to', 'from', 'that', 'this', 'is', 'it', 'of', 'on', 'at', 'by', 'as', 'like', 'want', 'need', 'yarn', 'yarns', 'do', 'you', 'have', 'they', 'got', 'show', 'me']);
      const rawKeywords = nameLower.split(/\s+/).filter(Boolean);
      const keywords = rawKeywords.filter((w) => w.length > 1 && !stopwords.has(w));
      if (keywords.length >= 1 && keywords.length <= 4) {
        const multiMatches = yarnNames.filter((y) => keywords.every((kw) => y.toLowerCase().includes(kw)));
        if (multiMatches.length === 1) {
          const chosenYarnName = multiMatches[0];
          const html = generateHTMLResponse('Add item', `<p>You chose <strong>${chosenYarnName}</strong>. How many units do you want to add?</p><p class="summary">Reply with a number (e.g. 20 or 50).</p>`) + buildOrderDetailsHtml(order) + EDIT_MORE_OR_COMPLETE_PROMPT;
          return { html, editOrderContext: { purchaseOrderId, poNumber, addItemState: { ...addItemState, step: 'quantity', chosenYarnName, searchMatches: null } } };
        }
        if (multiMatches.length > 1) {
          const listHtml = multiMatches.map((y, i) => `${i + 1}. ${y}`).join('<br/>');
          const html = generateHTMLResponse('Add item', `<p>Here are yarns matching "<strong>${rawMsg}</strong>". Reply with the <strong>number</strong> (1–${multiMatches.length}):</p><p class="summary" style="margin: 0.6em 0; padding-left: 1em; line-height: 1.6;">${listHtml}</p>`) + buildOrderDetailsHtml(order) + EDIT_MORE_OR_COMPLETE_PROMPT;
          return { html, editOrderContext: { purchaseOrderId, poNumber, addItemState: { ...addItemState, searchMatches: multiMatches } } };
        }
      }
      // Yarn name or keyword match (exact or substring)
      const chosenByName = yarnNames.find((y) => y.toLowerCase() === nameLower || y.toLowerCase().includes(nameLower) || nameLower.includes(y.toLowerCase()));
      if (chosenByName) {
        const html = generateHTMLResponse('Add item', `<p>You chose <strong>${chosenByName}</strong>. How many units do you want to add?</p><p class="summary">Reply with a number (e.g. 20 or 50).</p>`) + buildOrderDetailsHtml(order) + EDIT_MORE_OR_COMPLETE_PROMPT;
        return { html, editOrderContext: { purchaseOrderId, poNumber, addItemState: { ...addItemState, step: 'quantity', chosenYarnName: chosenByName } } };
      }
      // No match: re-show list and prompt
      const listHtml = slice.map((y, i) => `${start + i + 1}. ${y}`).join('<br/>');
      const noMatchHtml = generateHTMLResponse('Add item', `<p>No yarn found matching "<strong>${rawMsg}</strong>". Here are yarn items from <strong>${supplierName}</strong> (page ${page}):</p><p class="summary" style="margin: 0.6em 0; padding-left: 1em; line-height: 1.6;">${listHtml || 'No yarn list.'}</p>${hasMore ? `<p class="summary">Reply with <strong>load more</strong> for more options.</p>` : ''}<p class="summary" style="margin-top: 0.8em;">Reply with the <strong>number</strong>, <strong>name</strong>, or a <strong>keyword</strong> (e.g. blue, black, nylon) to add.</p>`) + buildOrderDetailsHtml(order) + EDIT_MORE_OR_COMPLETE_PROMPT;
      return { html: noMatchHtml, editOrderContext: { purchaseOrderId, poNumber, addItemState: { ...addItemState, searchMatches: null } } };
    }

    if (addItemState.step === 'quantity' && addItemState.chosenYarnName) {
      const qtyNum = parseInt(rawMsg, 10);
      if (!Number.isNaN(qtyNum) && qtyNum > 0) {
        const html = generateHTMLResponse('Add item', `<p>Adding <strong>${addItemState.chosenYarnName}</strong> × ${qtyNum}. What <strong>rate</strong> (₹ per unit) do you want?</p><p class="summary">Reply with a number (e.g. 100 or 85).</p>`) + buildOrderDetailsHtml(order) + EDIT_MORE_OR_COMPLETE_PROMPT;
        return { html, editOrderContext: { purchaseOrderId, poNumber, addItemState: { ...addItemState, step: 'rate', quantity: qtyNum } } };
      }
    }

    if (addItemState.step === 'rate' && addItemState.chosenYarnName && addItemState.quantity != null) {
      const rateNum = parseFloat(rawMsg.replace(/[^\d.]/g, ''));
      if (!Number.isNaN(rateNum) && rateNum >= 0) {
        const catalogList = await yarnCatalogService.queryYarnCatalogs({ yarnName: addItemState.chosenYarnName }, { limit: 1 });
        const yarnCatalog = catalogList?.results?.[0] || catalogList?.[0] || null;
        if (!yarnCatalog) {
          const html = generateHTMLResponse('Yarn Not Found', `Yarn "${addItemState.chosenYarnName}" not found in catalog. Add it to the catalog first.`) + buildOrderDetailsHtml(order) + EDIT_MORE_OR_COMPLETE_PROMPT;
          return { html, editOrderContext: { purchaseOrderId, poNumber } };
        }
        const yarnId = yarnCatalog._id?.toString?.() || yarnCatalog.id;
        const newItem = {
          yarn: yarnId,
          yarnName: yarnCatalog.yarnName || addItemState.chosenYarnName,
          sizeCount: (items[0]?.sizeCount ?? '-'),
          shadeCode: items[0]?.shadeCode ?? '',
          rate: rateNum,
          quantity: addItemState.quantity,
          gstRate: items[0]?.gstRate
        };
        const newItems = [...items.map((it) => (it.toObject ? it.toObject() : { ...it })), newItem];
        const { subTotal, gst, total } = recomputeOrderTotals(newItems);
        await yarnPurchaseOrderService.updatePurchaseOrderById(purchaseOrderId, { poItems: newItems, subTotal, gst, total });
        const updated = await yarnPurchaseOrderService.getPurchaseOrderById(purchaseOrderId);
        const html = buildOrderDetailsHtml(updated) + EDIT_MORE_OR_COMPLETE_PROMPT;
        return { html, editOrderContext: { purchaseOrderId, poNumber: updated.poNumber } };
      }
    }
  }

  // Vague quantity intent: "change quantity", "lets change quantity", "update quantity" (no number) — ask for specific instruction
  const vagueQty = /^(?:lets?\s+)?(?:change|update)\s+(?:the\s+)?quantity\s*\.?$|(?:i\s+)?(?:want\s+to\s+)?(?:change|update)\s+(?:the\s+)?quantity\s*\.?$/i.test(msg) ||
    /^(?:change|update)\s+(?:the\s+)?quantity\s+(?:in\s+)?(?:a\s+)?(?:purchase\s+)?order\s*\.?$/i.test(msg);
  if (vagueQty && items.length > 0) {
    const itemList = items.map((it, i) => `${i + 1}. ${(it.yarnName || it.yarn?.yarnName || 'Item')} — current qty: ${it.quantity ?? 0}`).join('<br/>');
    return {
      html: generateHTMLResponse(
        'Change quantity',
        `<p>To change quantity, tell me the new value.</p><p><strong>Current items:</strong></p><p>${itemList}</p><p><strong>Examples:</strong></p><ul><li>For the first item: <strong>quantity to 50</strong></li><li>For a specific yarn: <strong>set quantity of [yarn name] to 60</strong></li></p><p>Reply with the quantity you want (e.g. "quantity to 199" or "set quantity of 110/70-Brown to 100").</p>`
      ) + EDIT_MORE_OR_COMPLETE_PROMPT,
      editOrderContext: { purchaseOrderId, poNumber }
    };
  }

  // Status changes are handled by the UPDATE STATUS flow only (not in edit flow). If user asked for status here, direct them.
  const statusAskedInEdit = /(?:set|update|change)\s+status\s+to\s+|(?:mark\s+as|set\s+to)\s+(?:in\s+transit|goods\s+received|qc\s+pending|submitted|po\s+accepted|po\s+rejected)/i.test(rawMsg);
  if (statusAskedInEdit) {
    return {
      html: generateHTMLResponse('Update status', `<p>To change the order status, say <strong>update status to [status]</strong> or <strong>mark as in transit</strong> — that’s handled in a separate step.</p>`) + buildOrderDetailsHtml(order) + EDIT_MORE_OR_COMPLETE_PROMPT,
      editOrderContext: { purchaseOrderId, poNumber }
    };
  }

  // Increase quantity by N: "increase quantity by 50", "increase it by 50", "increase by 50", "quantity increase by 50"
  const increaseMatch = msg.match(/(?:increase|add)\s+(?:the\s+|quantity\s+|it\s+)?by\s+(\d+)/i) || msg.match(/(?:quantity\s+)?increase\s+by\s+(\d+)/i);
  if (increaseMatch && items.length > 0) {
    const addQty = parseInt(increaseMatch[1], 10);
    if (addQty > 0) {
      let idx = 0;
      const forYarnMatch = msg.match(/(?:for|of)\s+(.+?)(?:\s+by\s+|\s+increase|$)/i);
      if (forYarnMatch && forYarnMatch[1]) {
        const search = forYarnMatch[1].trim().toLowerCase();
        const i = items.findIndex((it) => getYarnName(it).includes(search) || search.includes(getYarnName(it)));
        if (i !== -1) idx = i;
      }
      const currentQty = items[idx].quantity ?? 0;
      const newQty = currentQty + addQty;
      const newItems = items.map((it, i) => {
        const plain = it.toObject ? it.toObject() : { ...it };
        return i === idx ? { ...plain, quantity: newQty } : plain;
      });
      const { subTotal, gst, total } = recomputeOrderTotals(newItems);
      await yarnPurchaseOrderService.updatePurchaseOrderById(purchaseOrderId, { poItems: newItems, subTotal, gst, total });
      const updated = await yarnPurchaseOrderService.getPurchaseOrderById(purchaseOrderId);
      const itemLabel = items[idx].yarnName || items[idx].yarn?.yarnName || 'item';
      let html = generateHTMLResponse('Quantity Updated', `Increased <strong>${itemLabel}</strong> by <strong>${addQty}</strong> (was ${currentQty}, now ${newQty}).`) + buildOrderDetailsHtml(updated);
      // If user also asked for supplier yarn list in same message, append it
      const alsoAskedSupplierYarn = /(?:what|which|list|give\s+me|tell\s+me)\s+(?:more\s+)?(?:yarn|items?)|(?:what\s+items?|what\s+else)\s+(?:does\s+)?(?:this\s+)?supplier|what\s+(?:more\s+)?yarn\s+(?:are\s+)?available/i.test(msg);
      if (alsoAskedSupplierYarn) {
        // Order has supplier; fetch that supplier's yarn list only
        const supplierIdFromOrder = updated.supplier?._id || updated.supplier;
        if (supplierIdFromOrder) {
          try {
            const supplier = await supplierService.getSupplierById(supplierIdFromOrder);
            const supplierName = supplier?.brandName || updated.supplier?.brandName || 'this supplier';
            const yarnDetails = supplier?.yarnDetails || [];
            const yarnNames = [...new Set(yarnDetails.map((d) => d.yarnName).filter(Boolean))];
            if (yarnNames.length > 0) {
              const listHtml = yarnNames.map((name) => `<li><strong>${name}</strong></li>`).join('');
              html += generateHTMLResponse(`Yarn from ${supplierName}`, `<p>Yarn items <strong>${supplierName}</strong> provides:</p><ul>${listHtml}</ul><p>To add: say <strong>add [yarn name] [qty] at [rate]</strong> — e.g. "add 33/2/120-Dark Grey 20 at 100".</p>`);
            } else {
              html += generateHTMLResponse(`Yarn from ${supplierName}`, `<p>No yarn list on file for this supplier. You can add by name: "add [yarn name] 20 at 100".</p>`);
            }
          } catch (e) {
            console.warn('Supplier yarn list append failed:', e?.message);
          }
        }
      }
      html += EDIT_MORE_OR_COMPLETE_PROMPT;
      return { html, editOrderContext: { purchaseOrderId, poNumber: updated.poNumber } };
    }
  }

  // Remove item sub-flow: 1) show numbered list → 2) user types number(s) → 3) confirm with names → 4) yes = remove, no = cancel
  const removeItemState = editContext?.removeItemState;
  if (removeItemState?.step === 'confirm_remove' && removeItemState.indices && removeItemState.yarnNames) {
    const isYes = /^(?:yes|y|confirm)\s*$/i.test(rawMsg.trim());
    const isNo = /^(?:no|n|cancel)\s*$/i.test(rawMsg.trim());
    if (isYes) {
      const indicesSet = new Set(removeItemState.indices);
      const newItems = items.filter((_, i) => !indicesSet.has(i)).map((it) => (it.toObject ? it.toObject() : { ...it }));
      const { subTotal, gst, total } = recomputeOrderTotals(newItems);
      await yarnPurchaseOrderService.updatePurchaseOrderById(purchaseOrderId, { poItems: newItems, subTotal, gst, total });
      const updated = await yarnPurchaseOrderService.getPurchaseOrderById(purchaseOrderId);
      const namesList = removeItemState.yarnNames.join(', ');
      return {
        html: buildOrderDetailsHtml(updated) + EDIT_MORE_OR_COMPLETE_PROMPT,
        editOrderContext: { purchaseOrderId, poNumber: updated.poNumber }
      };
    }
    if (isNo) {
      return {
        html: buildOrderDetailsHtml(order) + EDIT_MORE_OR_COMPLETE_PROMPT,
        editOrderContext: { purchaseOrderId, poNumber }
      };
    }
    return {
      html: generateHTMLResponse('Confirm', `<p class="summary">Remove these? <strong>yes</strong> / <strong>no</strong></p><p class="summary" style="margin: 0.4em 0; padding-left: 1em;">${removeItemState.yarnNames.map((n, i) => `${i + 1}. ${n}`).join('<br/>')}</p>`) + buildOrderDetailsHtml(order) + EDIT_MORE_OR_COMPLETE_PROMPT,
      editOrderContext: { purchaseOrderId, poNumber, removeItemState }
    };
  }

  if (removeItemState?.step === 'choose_items' && Array.isArray(items) && items.length > 0) {
    const numStr = rawMsg.replace(/\s+/g, '').trim();
    const parts = numStr.split(',').map((s) => parseInt(s, 10)).filter((n) => !Number.isNaN(n) && n >= 1 && n <= items.length);
    const uniqueIndices = [...new Set(parts)].sort((a, b) => a - b).map((oneBased) => oneBased - 1);
    if (uniqueIndices.length > 0) {
      const yarnNames = uniqueIndices.map((i) => items[i].yarnName || items[i].yarn?.yarnName || 'Item').filter(Boolean);
      const listHtml = yarnNames.map((n, i) => `${i + 1}. ${n}`).join('<br/>');
      const newRemoveState = { step: 'confirm_remove', indices: uniqueIndices, yarnNames };
      return {
        html: generateHTMLResponse('Confirm', `<p class="summary">Remove these? <strong>yes</strong> / <strong>no</strong></p><p class="summary" style="margin: 0.4em 0; padding-left: 1em;">${listHtml}</p>`) + buildOrderDetailsHtml(order) + EDIT_MORE_OR_COMPLETE_PROMPT,
        editOrderContext: { purchaseOrderId, poNumber, removeItemState: newRemoveState }
      };
    }
    const listHtml = items.map((it, i) => `${i + 1}. ${it.yarnName || it.yarn?.yarnName || 'Item'}`).join('<br/>');
    return {
      html: generateHTMLResponse('Remove item', `<p class="summary">Reply with number(s), e.g. <strong>1</strong> or <strong>1, 3</strong>:</p><p class="summary" style="margin: 0.4em 0; padding-left: 1em; line-height: 1.5;">${listHtml}</p>`) + buildOrderDetailsHtml(order) + EDIT_MORE_OR_COMPLETE_PROMPT,
      editOrderContext: { purchaseOrderId, poNumber, removeItemState }
    };
  }

  // "Remove item" / "remove items" — show numbered list of yarns in order so user can pick by number(s)
  const vagueRemoveItem = /^(?:remove|delete)\s+(?:an?\s+)?(?:item|line)\s*\.?$/i.test(rawMsg.trim()) || /^(?:remove|delete)\s+items?\s*\.?$/i.test(rawMsg.trim());
  if (vagueRemoveItem) {
    if (items.length === 0) {
      return {
        html: buildOrderDetailsHtml(order) + EDIT_MORE_OR_COMPLETE_PROMPT,
        editOrderContext: { purchaseOrderId, poNumber }
      };
    }
    if (items.length === 1) {
      return {
        html: generateHTMLResponse('Only one item', `This order has only one item. Removing it would leave the order empty. Do you want to delete the entire order? Reply <strong>yes, delete order</strong> or <strong>delete this order</strong> to delete it.`) + buildOrderDetailsHtml(order) + EDIT_MORE_OR_COMPLETE_PROMPT,
        editOrderContext: { purchaseOrderId, poNumber, confirmDeleteOrder: true }
      };
    }
    const listHtml = items.map((it, i) => `${i + 1}. ${it.yarnName || it.yarn?.yarnName || 'Item'}`).join('<br/>');
    return {
      html: generateHTMLResponse('Remove item', `<p class="summary">Reply with number(s), e.g. <strong>1</strong> or <strong>1, 3</strong>:</p><p class="summary" style="margin: 0.4em 0; padding-left: 1em; line-height: 1.5;">${listHtml}</p>`) + buildOrderDetailsHtml(order) + EDIT_MORE_OR_COMPLETE_PROMPT,
      editOrderContext: { purchaseOrderId, poNumber, removeItemState: { step: 'choose_items' } }
    };
  }

  // Remove item: "remove [yarn name]" — direct remove by name (single item); if only one item in order, ask about deleting entire order
  const removeMatch = msg.match(/remove\s+(.+?)(?:\.|$)/i);
  if (removeMatch) {
    if (items.length === 1) {
      return {
        html: generateHTMLResponse('Only one item', `This order has only one item. Removing it would leave the order empty. Do you want to delete the entire order? Reply <strong>yes, delete order</strong> or <strong>delete this order</strong> to delete it.`) + buildOrderDetailsHtml(order) + EDIT_MORE_OR_COMPLETE_PROMPT,
        editOrderContext: { purchaseOrderId, poNumber, confirmDeleteOrder: true }
      };
    }
    const search = removeMatch[1].trim().toLowerCase();
    const idx = items.findIndex((it) => getYarnName(it).includes(search) || search.includes(getYarnName(it)));
    if (idx !== -1) {
      const removed = items[idx].yarnName || 'item';
      const newItems = items.filter((_, i) => i !== idx).map((it) => (it.toObject ? it.toObject() : { ...it }));
      const { subTotal, gst, total } = recomputeOrderTotals(newItems);
      await yarnPurchaseOrderService.updatePurchaseOrderById(purchaseOrderId, { poItems: newItems, subTotal, gst, total });
      const updated = await yarnPurchaseOrderService.getPurchaseOrderById(purchaseOrderId);
      return {
        html: buildOrderDetailsHtml(updated) + EDIT_MORE_OR_COMPLETE_PROMPT,
        editOrderContext: { purchaseOrderId, poNumber: updated.poNumber }
      };
    }
  }

  // Update quantity: "set quantity of [yarn] to N", "change quantity to N" (first item), or "quantity to N"
  const qtyMatch = msg.match(/(?:set|change|update)\s+(?:the\s+)?quantity\s+(?:of\s+)(.+?)\s+to\s+(\d+)/i) ||
    msg.match(/(?:set|change|update)\s+(?:the\s+)?quantity\s+to\s+(\d+)/i) ||
    msg.match(/quantity\s+to\s+(\d+)/i);
  if (qtyMatch) {
    const newQty = parseInt(qtyMatch[2] || qtyMatch[1], 10);
    if (newQty > 0) {
      let idx = 0;
      // If we have a yarn name (first pattern), find that item; otherwise first item
      if (qtyMatch[1] && isNaN(Number(qtyMatch[1]))) {
        const search = qtyMatch[1].trim().toLowerCase();
        const i = items.findIndex((it) => getYarnName(it).includes(search) || search.includes(getYarnName(it)));
        if (i !== -1) idx = i;
      }
      const newItems = items.map((it, i) => {
        const plain = it.toObject ? it.toObject() : { ...it };
        return i === idx ? { ...plain, quantity: newQty } : plain;
      });
      const { subTotal, gst, total } = recomputeOrderTotals(newItems);
      await yarnPurchaseOrderService.updatePurchaseOrderById(purchaseOrderId, { poItems: newItems, subTotal, gst, total });
      const updated = await yarnPurchaseOrderService.getPurchaseOrderById(purchaseOrderId);
      return {
        html: generateHTMLResponse('Quantity Updated', `Quantity updated to <strong>${newQty}</strong>.`) + buildOrderDetailsHtml(updated) + EDIT_MORE_OR_COMPLETE_PROMPT,
        editOrderContext: { purchaseOrderId, poNumber: updated.poNumber }
      };
    }
  }

  // "What yarn from this supplier" / "list yarn to add" / "what items does this supplier have" — show supplier's yarn list so user can add by name
  const supplierYarnAsk = /(?:what|which|list|give\s+me|tell\s+me|show\s+me)\s+(?:more\s+)?(?:yarn|items?)\s+(?:from\s+this\s+supplier|(?:to\s+add|available|(?:that\s+)?this\s+supplier\s+(?:provide|have|supply)s?))?/i.test(msg) ||
    /(?:what|which)\s+(?:items?|yarn)\s+(?:does\s+)?(?:this\s+)?supplier\s+(?:have|provide|supply)/i.test(msg) ||
    /(?:what\s+else|list\s+of\s+yarn)\s+(?:does\s+)?(?:this\s+)?supplier\s+(?:provide|have)/i.test(msg) ||
    /(?:yes\s+)?tell\s+me\s+what\s+(?:more\s+)?yarn\s+(?:are\s+)?available/i.test(msg) ||
    /give\s+me\s+(?:the\s+)?list\s+of\s+yarn\s+items?/i.test(msg) ||
    /list\s+of\s+yarn\s+items?\s+to\s+add/i.test(msg) ||
    /what\s+else\s+this\s+supplier\s+provide/i.test(msg);
  if (supplierYarnAsk) {
    // Every order has supplier (populated when fetched by PO number/ID); fetch yarn items of that supplier only
    const supplierNameFromOrder = order.supplier?.brandName || (typeof order.supplier === 'string' ? order.supplier : null);
    if (orderSupplierId) {
      try {
        const supplier = await supplierService.getSupplierById(orderSupplierId);
        const supplierName = supplierNameFromOrder || supplier?.brandName || 'this supplier';
        const yarnDetails = supplier?.yarnDetails || [];
        const yarnNames = yarnDetails.map((d) => d.yarnName).filter(Boolean);
        const uniqueNames = [...new Set(yarnNames)];
        if (uniqueNames.length > 0) {
          const listHtml = uniqueNames.map((name, i) => `<li><strong>${name}</strong></li>`).join('');
          return {
            html: generateHTMLResponse(
              `Yarn from ${supplierName}`,
              `<p>Here are the yarn items <strong>${supplierName}</strong> provides:</p><ul>${listHtml}</ul><p>To add any of these to your order, say: <strong>add [yarn name] [quantity] at [rate]</strong> — e.g. "add 33/2/120-Dark Grey 20 at 100".</p>`
            ) + buildOrderDetailsHtml(order) + EDIT_MORE_OR_COMPLETE_PROMPT,
            editOrderContext: { purchaseOrderId, poNumber }
          };
        }
        return {
          html: generateHTMLResponse(
            `Yarn from ${supplierName}`,
            `<p>No yarn list is on file for <strong>${supplierName}</strong>. You can still add yarn by name if it exists in the catalog — e.g. "add [yarn name] 20 at 100".</p>`
          ) + buildOrderDetailsHtml(order) + EDIT_MORE_OR_COMPLETE_PROMPT,
          editOrderContext: { purchaseOrderId, poNumber }
        };
      } catch (e) {
        console.warn('Failed to load supplier yarn list:', e?.message);
      }
    }
    return {
      html: generateHTMLResponse('Supplier info', `<p>I couldn't load the yarn list for this order's supplier. You can add yarn by name — e.g. "add [yarn name] 20 at 100".</p>`) + buildOrderDetailsHtml(order) + EDIT_MORE_OR_COMPLETE_PROMPT,
      editOrderContext: { purchaseOrderId, poNumber }
    };
  }

  // Vague "add item" intent: "add item", "add more yarn", "i wanna add more yarn", etc. — show only this order's supplier yarn list (catalog of that supplier)
  const vagueAddItem =
    /^(?:i\s+)?(?:want\s+to\s+|wanna\s+)?add\s+(?:an?\s+)?item\s*\.?$/i.test(rawMsg) ||
    /^add\s+(?:an?\s+)?item\s*\.?$/i.test(rawMsg) ||
    /^(?:i\s+)?(?:want\s+to\s+|wanna\s+)?add\s+more\s+(?:yarn|items?)\s*\.?$/i.test(rawMsg) ||
    /^add\s+more\s+(?:yarn|items?)\s*\.?$/i.test(rawMsg);
  if (vagueAddItem) {
    // Order has supplier; fetch that particular supplier's yarn list only (from order fetched by PO number/ID)
    const supplierNameFromOrder = order.supplier?.brandName || (typeof order.supplier === 'string' ? order.supplier : null);
    if (orderSupplierId) {
      try {
        const supplier = await supplierService.getSupplierById(orderSupplierId);
        const supplierName = supplierNameFromOrder || supplier?.brandName || 'this supplier';
        const yarnDetails = supplier?.yarnDetails || [];
        const yarnNames = [...new Set((yarnDetails || []).map((d) => (d.yarnName || (d.yarnType && d.yarnType.name) || '').trim()).filter(Boolean))];
        if (yarnNames.length > 0) {
          const pageSize = EDIT_ADD_ITEM_PAGE_SIZE;
          const page = 1;
          const slice = yarnNames.slice(0, pageSize);
          const hasMore = yarnNames.length > pageSize;
          const listHtml = slice.map((y, i) => `${i + 1}. ${y}`).join('<br/>');
          const html = generateHTMLResponse(
            'Add item',
            `<p>Here are yarn items from <strong>${supplierName}</strong> (top ${slice.length}):</p><p class="summary" style="margin: 0.6em 0; padding-left: 1em; line-height: 1.6;">${listHtml}</p>${hasMore ? `<p class="summary">Reply with <strong>load more</strong> for more options.</p>` : ''}<p class="summary" style="margin-top: 0.8em;">Reply with the <strong>number</strong>, <strong>name</strong>, or a <strong>keyword</strong> (e.g. blue, black, nylon — or "do you have anything in blue") to add; then I'll ask for quantity and rate.</p>`
          ) + buildOrderDetailsHtml(order) + EDIT_MORE_OR_COMPLETE_PROMPT;
          return {
            html,
            editOrderContext: { purchaseOrderId, poNumber, addItemState: { step: 'choose_yarn', yarnNames, page: 1, supplierId: orderSupplierId.toString?.() || orderSupplierId, supplierName } }
          };
        }
      } catch (e) {
        console.warn('Failed to load supplier yarn list for add item:', e?.message);
      }
    }
  }

  // Add item: "add [yarn name] N at R" or "add [yarn] N at R"
  const addMatch = msg.match(/add\s+(.+?)\s+(\d+)\s*(?:pieces?|pcs?|qty)?\s*(?:at|@|\s+rate)?\s*(\d+(?:\.\d+)?)?/i);
  if (addMatch) {
    const yarnNamePart = addMatch[1].trim();
    const qty = parseInt(addMatch[2], 10);
    const rate = addMatch[3] != null ? parseFloat(addMatch[3]) : (items[0]?.rate ?? 0);
    if (qty > 0 && rate >= 0) {
      const catalogList = await yarnCatalogService.queryYarnCatalogs({ yarnName: yarnNamePart }, { limit: 1 });
      const yarnCatalog = catalogList?.results?.[0] || catalogList?.[0] || null;
      if (!yarnCatalog) {
        return {
          html: generateHTMLResponse('Yarn Not Found', `Yarn "${yarnNamePart}" not found in catalog. Add it to the catalog first.`),
          editOrderContext: { purchaseOrderId, poNumber }
        };
      }
      const yarnId = yarnCatalog._id?.toString?.() || yarnCatalog.id;
      const newItem = {
        yarn: yarnId,
        yarnName: yarnCatalog.yarnName || yarnNamePart,
        sizeCount: (items[0]?.sizeCount ?? '-'),
        shadeCode: items[0]?.shadeCode ?? '',
        rate,
        quantity: qty,
        gstRate: items[0]?.gstRate
      };
      const newItems = [...items.map((it) => (it.toObject ? it.toObject() : { ...it })), newItem];
      const { subTotal, gst, total } = recomputeOrderTotals(newItems);
      await yarnPurchaseOrderService.updatePurchaseOrderById(purchaseOrderId, { poItems: newItems, subTotal, gst, total });
      const updated = await yarnPurchaseOrderService.getPurchaseOrderById(purchaseOrderId);
      return {
        html: buildOrderDetailsHtml(updated) + EDIT_MORE_OR_COMPLETE_PROMPT,
        editOrderContext: { purchaseOrderId, poNumber: updated.poNumber }
      };
    }
  }

  return {
    html: generateHTMLResponse('Edit Help', `Choose what to edit: <strong>Quantity</strong>, <strong>Add item</strong>, or <strong>Remove item</strong>. Example: "set quantity of [yarn] to 60". Say <strong>complete</strong> or <strong>done</strong> to finish. For status changes, use <strong>update status</strong> from the main menu.`) + EDIT_MORE_OR_COMPLETE_PROMPT,
    editOrderContext: { purchaseOrderId, poNumber }
  };
};

/**
 * Get yarn types
 * @param {Object} params - Parameters with optional filters (name, status, yarnTypeName, yarnSubtype, details)
 * @returns {Promise<string>} HTML string with yarn types
 */
export const getYarnTypes = async (params = {}) => {
  try {
    const { limit = 50, page = 1, name, yarnTypeName, status, yarnSubtype, details } = params;
    
    // Build filter object
    let filter = {};
    if (name || yarnTypeName) {
      filter.name = { $regex: name || yarnTypeName, $options: 'i' };
    }
    if (status) {
      filter.status = status.toLowerCase();
    }
    if (yarnSubtype || details) {
      // Filter by details.subtype
      filter['details.subtype'] = { $regex: yarnSubtype || details, $options: 'i' };
    }
    
    const yarnTypes = await yarnTypeService.queryYarnTypes(filter, { 
      limit: parseInt(limit) || 50,
      page: parseInt(page) || 1
    });
    
    if (!yarnTypes.results || yarnTypes.results.length === 0) {
      const filterSummary = Object.keys(filter).length > 0 
        ? ` with filters: ${Object.keys(filter).join(', ')}` 
        : '';
      return generateHTMLResponse('No Yarn Types Found', `No yarn types found${filterSummary}.`);
    }
    
    // Calculate summary statistics
    const totalCount = yarnTypes.totalResults || yarnTypes.results.length;
    const activeCount = yarnTypes.results.filter(t => t.status === 'active' || t.status === 'Active').length;
    const inactiveCount = yarnTypes.results.filter(t => t.status === 'inactive' || t.status === 'Inactive').length;
    
    // Build filter summary
    const filterSummary = [];
    if (name || yarnTypeName) filterSummary.push(`name: ${name || yarnTypeName}`);
    if (status) filterSummary.push(`status: ${status}`);
    if (yarnSubtype || details) filterSummary.push(`subtype: ${yarnSubtype || details}`);
    const filterText = filterSummary.length > 0 ? ` (filtered by ${filterSummary.join(', ')})` : '';
    
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>🧵 Yarn Types${filterText}</h3>
        
        <!-- Summary KPIs -->
        <div class="kpi-grid">
          <div class="kpi-item">
            <div class="kpi-label">Total Yarn Types</div>
            <div class="kpi-value">${totalCount.toLocaleString()}</div>
            <div class="kpi-change">In System</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Active Types</div>
            <div class="kpi-value">${activeCount.toLocaleString()}</div>
            <div class="kpi-change">Currently Active</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Inactive Types</div>
            <div class="kpi-value">${inactiveCount.toLocaleString()}</div>
            <div class="kpi-change">Not Active</div>
          </div>
        </div>
        
        <!-- Yarn Types Table -->
        <div class="chart-container">
          <h4>📋 Yarn Types List</h4>
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Details/Subtypes</th>
                  <th>Created At</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${yarnTypes.results.map((type) => {
                  const detailsList = type.details && Array.isArray(type.details) && type.details.length > 0
                    ? type.details.map(d => d.subtype || 'N/A').join(', ')
                    : 'N/A';
                  return `
                  <tr>
                    <td><strong>${type.name || 'N/A'}</strong></td>
                    <td>${detailsList}</td>
                    <td>${type.createdAt ? new Date(type.createdAt).toLocaleString() : 'N/A'}</td>
                    <td><span style="background: ${type.status === 'active' ? '#d4edda' : '#f8d7da'}; color: ${type.status === 'active' ? '#155724' : '#721c24'}; padding: 4px 8px; border-radius: 6px; font-weight: 600; text-transform: capitalize;">${type.status || 'N/A'}</span></td>
                  </tr>
                `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
        
        <p class="summary">Found ${totalCount.toLocaleString()} yarn types${filterText}${yarnTypes.totalResults > yarnTypes.results.length ? ` (showing ${yarnTypes.results.length} of ${yarnTypes.totalResults})` : ''} with ${activeCount} active and ${inactiveCount} inactive.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getYarnTypes:', error);
    return generateHTMLResponse('Error', `Failed to retrieve yarn types: ${error.message}`);
  }
};

/**
 * Get yarn suppliers/brands
 * @param {Object} params - Parameters
 * @returns {Promise<string>} HTML string with suppliers
 */
export const getYarnSuppliers = async (params = {}) => {
  try {
    const { limit = 50 } = params;
    
    const suppliers = await supplierService.querySuppliers({}, { limit: parseInt(limit) || 50 });
    
    if (!suppliers.results || suppliers.results.length === 0) {
      return generateHTMLResponse('No Suppliers Found', 'No yarn suppliers found in the system.');
    }
    
    // Calculate summary statistics
    const totalCount = suppliers.totalResults || suppliers.results.length;
    const activeCount = suppliers.results.filter(s => s.status === 'Active' || s.status === 'active').length;
    const inactiveCount = suppliers.results.filter(s => s.status === 'Inactive' || s.status === 'inactive').length;
    const brands = [...new Set(suppliers.results.map(s => s.brandName).filter(Boolean))];
    
    const numberedList = suppliers.results
      .map((s, i) => {
        const name = s.brandName || s.supplierName || 'N/A';
        const extra = [s.supplierName && s.supplierName !== name ? s.supplierName : null, s.contactPerson || s.email].filter(Boolean).join(' • ');
        return `${i + 1}. ${name}${extra ? ` <span class="summary" style="color:#64748b;">(${extra})</span>` : ''}`;
      })
      .join('<br/>');

    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>🏷️ Yarn Suppliers/Brands</h3>
        <p class="summary" style="margin: 0.4em 0;">Total: <strong>${totalCount}</strong> suppliers${suppliers.totalResults > suppliers.results.length ? ` (showing ${suppliers.results.length} of ${suppliers.totalResults})` : ''} • <strong>${activeCount}</strong> active • <strong>${brands.length}</strong> unique brands.</p>
        <p class="summary" style="margin: 0.6em 0;"><strong>Numbered list:</strong></p>
        <p class="summary" style="margin: 0.4em 0; padding-left: 1em; line-height: 1.6;">${numberedList}</p>
        <p class="summary" style="margin-top: 0.8em;">You can place an order by saying <strong>place order</strong> and then typing a supplier name from this list, or <strong>show supplier list</strong> to pick by number.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getYarnSuppliers:', error);
    return generateHTMLResponse('Error', `Failed to retrieve suppliers: ${error.message}`);
  }
};

/**
 * Get yarn count sizes
 * @param {Object} params - Parameters
 * @returns {Promise<string>} HTML string with count sizes
 */
export const getYarnCountSizes = async (params = {}) => {
  try {
    const { limit = 50 } = params;
    
    const countSizes = await countSizeService.queryCountSizes({}, { limit: parseInt(limit) || 50 });
    
    if (!countSizes.results || countSizes.results.length === 0) {
      return generateHTMLResponse('No Count Sizes Found', 'No yarn count sizes found in the system.');
    }
    
    // Calculate summary statistics
    const totalCount = countSizes.totalResults || countSizes.results.length;
    const activeCount = countSizes.results.filter(s => s.status === 'Active' || s.status === 'active').length;
    const inactiveCount = countSizes.results.filter(s => s.status === 'Inactive' || s.status === 'inactive').length;
    
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>📏 Yarn Count Sizes</h3>
        
        <!-- Summary KPIs -->
        <div class="kpi-grid">
          <div class="kpi-item">
            <div class="kpi-label">Total Count Sizes</div>
            <div class="kpi-value">${totalCount.toLocaleString()}</div>
            <div class="kpi-change">In System</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Active Sizes</div>
            <div class="kpi-value">${activeCount.toLocaleString()}</div>
            <div class="kpi-change">Currently Active</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Inactive Sizes</div>
            <div class="kpi-value">${inactiveCount.toLocaleString()}</div>
            <div class="kpi-change">Not Active</div>
          </div>
        </div>
        
        <!-- Count Sizes Table -->
        <div class="chart-container">
          <h4>📋 Count Sizes List</h4>
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Created At</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${countSizes.results.map((size) => `
                  <tr>
                    <td><strong>${size.name || 'N/A'}</strong></td>
                    <td>${size.createdAt ? new Date(size.createdAt).toLocaleString() : 'N/A'}</td>
                    <td><span style="background: ${size.status === 'active' ? '#d4edda' : '#f8d7da'}; color: ${size.status === 'active' ? '#155724' : '#721c24'}; padding: 4px 8px; border-radius: 6px; font-weight: 600; text-transform: capitalize;">${size.status || 'N/A'}</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        
        <p class="summary">Found ${totalCount.toLocaleString()} count sizes${countSizes.totalResults > countSizes.results.length ? ` (showing ${countSizes.results.length} of ${countSizes.totalResults})` : ''} with ${activeCount} active and ${inactiveCount} inactive.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getYarnCountSizes:', error);
    return generateHTMLResponse('Error', `Failed to retrieve count sizes: ${error.message}`);
  }
};

/**
 * Get yarn colors
 * @param {Object} params - Parameters with optional page and limit
 * @returns {Promise<string>} HTML string with colors
 */
export const getYarnColors = async (params = {}) => {
  try {
    const { limit = 50, page = 1 } = params;
    const currentPage = parseInt(page) || 1;
    const pageLimit = parseInt(limit) || 50;
    
    const colors = await colorService.queryColors({}, { 
      limit: pageLimit,
      page: currentPage
    });
    
    if (!colors.results || colors.results.length === 0) {
      return generateHTMLResponse('No Colors Found', 'No yarn colors found in the system.');
    }
    
    // Calculate summary statistics
    const totalCount = colors.totalResults || colors.results.length;
    const totalPages = colors.totalPages || Math.ceil(totalCount / pageLimit);
    const activeCount = colors.results.filter(c => c.status === 'Active' || c.status === 'active').length;
    const inactiveCount = colors.results.filter(c => c.status === 'Inactive' || c.status === 'inactive').length;
    const paginationHTML = generatePaginationHTML(currentPage, totalPages, totalCount, 'yarn colors');
    
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>🎨 Yarn Colors</h3>
        
        <!-- Summary KPIs -->
        <div class="kpi-grid">
          <div class="kpi-item">
            <div class="kpi-label">Total Colors</div>
            <div class="kpi-value">${totalCount.toLocaleString()}</div>
            <div class="kpi-change">In System</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Active Colors</div>
            <div class="kpi-value">${activeCount.toLocaleString()}</div>
            <div class="kpi-change">Currently Active</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Inactive Colors</div>
            <div class="kpi-value">${inactiveCount.toLocaleString()}</div>
            <div class="kpi-change">Not Active</div>
          </div>
        </div>
        
        <!-- Colors Table -->
        <div class="chart-container">
          <h4>📋 Colors List</h4>
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Color Code</th>
                  <th>Pantone Name</th>
                  <th>Created At</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${colors.results.map((color) => `
                  <tr>
                    <td><strong>${color.name || 'N/A'}</strong></td>
                    <td>${color.colorCode || 'N/A'}</td>
                    <td>${color.pantoneName || 'N/A'}</td>
                    <td>${color.createdAt ? new Date(color.createdAt).toLocaleString() : 'N/A'}</td>
                    <td><span style="background: ${(color.status || '').toString().toLowerCase() === 'active' ? '#d4edda' : '#f8d7da'}; color: ${(color.status || '').toString().toLowerCase() === 'active' ? '#155724' : '#721c24'}; padding: 4px 8px; border-radius: 6px; font-weight: 600; text-transform: capitalize;">${color.status || 'N/A'}</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        
        ${paginationHTML}
        <p class="summary">Found ${totalCount.toLocaleString()} colors${totalCount > colors.results.length ? ` (showing ${colors.results.length} of ${totalCount} on page ${currentPage})` : ''} with ${activeCount} active and ${inactiveCount} inactive.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getYarnColors:', error);
    return generateHTMLResponse('Error', `Failed to retrieve colors: ${error.message}`);
  }
};

/**
 * Get suppliers that have yarn matching a given colour (keyword in yarn name).
 * @param {Object} params - { colour: string }
 * @returns {Promise<string>} HTML list of suppliers with that colour yarn
 */
export const getSuppliersByYarnColour = async (params = {}) => {
  try {
    const colour = (params?.colour || params?.color || '').trim();
    if (!colour) {
      return generateHTMLResponse('Colour needed', 'Please specify a colour, e.g. "which supplier has blue yarn".');
    }
    const colourLower = colour.toLowerCase();
    const suppliersResult = await supplierService.querySuppliers({}, { limit: 200, page: 1 });
    const suppliers = suppliersResult?.results ?? suppliersResult ?? [];
    const matchingSuppliers = [];
    for (const s of suppliers) {
      const id = (s._id || s.id)?.toString?.() || '';
      const supplier = await supplierService.getSupplierById(id);
      const yarnNames = supplier?.yarnDetails?.length
        ? (supplier.yarnDetails || []).map((d) => (d.yarnName || (d.yarnType && d.yarnType.name) || '').trim()).filter(Boolean)
        : [];
      const hasMatch = yarnNames.some((name) => name.toLowerCase().includes(colourLower));
      if (hasMatch) {
        matchingSuppliers.push({ id, brandName: supplier?.brandName || supplier?.name || s.brandName || s.name || 'Unknown' });
      }
    }
    if (matchingSuppliers.length === 0) {
      return generateHTMLResponse(
        'No suppliers found',
        `No supplier has yarn with "<strong>${colour}</strong>" in the name. Try another colour or ask for the supplier list to place an order.`
      );
    }
    const listHtml = matchingSuppliers.map((s, i) => `${i + 1}. ${s.brandName}`).join('<br/>');
    const hint = `Say <strong>buy yarn from [supplier name] in ${colour}</strong> to start an order.`;
    return generateHTMLResponse(
      `Suppliers with ${colour} yarn`,
      `<p>Suppliers that have <strong>${colour}</strong> yarn:</p><p class="summary" style="margin: 0.6em 0; padding-left: 1em; line-height: 1.6;">${listHtml}</p><p class="summary" style="margin-top: 0.8em;">${hint}</p>`
    );
  } catch (error) {
    console.error('Error in getSuppliersByYarnColour:', error);
    return generateHTMLResponse('Error', `Failed to find suppliers by colour: ${error.message}`);
  }
};

/**
 * Get yarn blends
 * @param {Object} params - Parameters
 * @returns {Promise<string>} HTML string with blends
 */
export const getYarnBlends = async (params = {}) => {
  try {
    const { limit = 50 } = params;
    
    const blends = await blendService.queryBlends({}, { limit: parseInt(limit) || 50 });
    
    if (!blends.results || blends.results.length === 0) {
      return generateHTMLResponse('No Blends Found', 'No yarn blends found in the system.');
    }
    
    // Calculate summary statistics
    const totalCount = blends.totalResults || blends.results.length;
    const activeCount = blends.results.filter(b => b.status === 'Active' || b.status === 'active').length;
    const inactiveCount = blends.results.filter(b => b.status === 'Inactive' || b.status === 'inactive').length;
    
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>🔀 Yarn Blends</h3>
        
        <!-- Summary KPIs -->
        <div class="kpi-grid">
          <div class="kpi-item">
            <div class="kpi-label">Total Blends</div>
            <div class="kpi-value">${totalCount.toLocaleString()}</div>
            <div class="kpi-change">In System</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Active Blends</div>
            <div class="kpi-value">${activeCount.toLocaleString()}</div>
            <div class="kpi-change">Currently Active</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Inactive Blends</div>
            <div class="kpi-value">${inactiveCount.toLocaleString()}</div>
            <div class="kpi-change">Not Active</div>
          </div>
        </div>
        
        <!-- Blends Table -->
        <div class="chart-container">
          <h4>📋 Blends List</h4>
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Created At</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${blends.results.map((blend) => `
                  <tr>
                    <td><strong>${blend.name || 'N/A'}</strong></td>
                    <td>${blend.createdAt ? new Date(blend.createdAt).toLocaleString() : 'N/A'}</td>
                    <td><span style="background: ${blend.status === 'active' ? '#d4edda' : '#f8d7da'}; color: ${blend.status === 'active' ? '#155724' : '#721c24'}; padding: 4px 8px; border-radius: 6px; font-weight: 600; text-transform: capitalize;">${blend.status || 'N/A'}</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        
        <p class="summary">Found ${totalCount.toLocaleString()} blends${blends.totalResults > blends.results.length ? ` (showing ${blends.results.length} of ${blends.totalResults})` : ''} with ${activeCount} active and ${inactiveCount} inactive.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getYarnBlends:', error);
    return generateHTMLResponse('Error', `Failed to retrieve blends: ${error.message}`);
  }
};

/**
 * Get raw materials
 * @param {Object} params - Parameters
 * @returns {Promise<string>} HTML string with raw materials
 */
export const getRawMaterials = async (params = {}) => {
  try {
    const { 
      limit = 50, 
      page = 1,
      groupName,
      type,
      brand,
      color,
      material,
      shade,
      unit,
      name,
      mrp,
      articleNo,
      hsnCode,
      gst,
      countSize,
      description,
      sortBy = 'createdAt:desc'
    } = params;
    
    // Build filter object - support ALL fields
    const filter = {};
    if (groupName) filter.groupName = { $regex: groupName, $options: 'i' };
    if (type) filter.type = { $regex: type, $options: 'i' };
    if (brand) filter.brand = { $regex: brand, $options: 'i' };
    if (color) filter.color = { $regex: color, $options: 'i' };
    if (material) filter.material = { $regex: material, $options: 'i' };
    if (shade) filter.shade = { $regex: shade, $options: 'i' };
    if (unit) filter.unit = { $regex: unit, $options: 'i' };
    if (name) filter.name = { $regex: name, $options: 'i' };
    if (mrp) filter.mrp = { $regex: mrp, $options: 'i' };
    if (articleNo) filter.articleNo = { $regex: articleNo, $options: 'i' };
    if (hsnCode) filter.hsnCode = { $regex: hsnCode, $options: 'i' };
    if (gst) filter.gst = { $regex: gst, $options: 'i' };
    if (countSize) filter.countSize = { $regex: countSize, $options: 'i' };
    if (description) filter.description = { $regex: description, $options: 'i' };
    
    const options = {
      limit: parseInt(limit) || 50,
      page: parseInt(page) || 1,
      sortBy: sortBy || 'createdAt:desc'
    };
    
    const rawMaterials = await rawMaterialService.queryRawMaterials(filter, options);
    
    if (!rawMaterials.results || rawMaterials.results.length === 0) {
      const filterSummary = Object.keys(filter).length > 0 
        ? ` with filters: ${Object.keys(filter).join(', ')}` 
        : '';
      return generateHTMLResponse('No Raw Materials Found', `No raw materials found${filterSummary}.`);
    }
    
    // Get all unique values for categorization
    const allMaterials = await rawMaterialService.queryRawMaterials({}, { limit: 10000 });
    const totalCount = rawMaterials.totalResults || 0;
    const totalPages = rawMaterials.totalPages || 1;
    const currentPage = rawMaterials.page || 1;
    
    // Calculate summary statistics from all materials
    const allGroupNames = [...new Set(allMaterials.results?.map(m => m.groupName).filter(Boolean) || [])];
    const allTypes = [...new Set(allMaterials.results?.map(m => m.type).filter(Boolean) || [])];
    const allBrands = [...new Set(allMaterials.results?.map(m => m.brand).filter(Boolean) || [])];
    const allColors = [...new Set(allMaterials.results?.map(m => m.color).filter(Boolean) || [])];
    
    // Current page statistics
    const activeCount = rawMaterials.results.filter(m => m.status === 'Active' || m.status === 'active').length;
    const inactiveCount = rawMaterials.results.filter(m => m.status === 'Inactive' || m.status === 'inactive').length;
    const categories = [...new Set(rawMaterials.results.map(m => m.groupName).filter(Boolean))];
    
    // Build filter summary - include ALL applied filters
    const appliedFilters = [];
    if (groupName) appliedFilters.push(`Group: ${groupName}`);
    if (type) appliedFilters.push(`Type: ${type}`);
    if (brand) appliedFilters.push(`Brand: ${brand}`);
    if (color) appliedFilters.push(`Color: ${color}`);
    if (material) appliedFilters.push(`Material: ${material}`);
    if (shade) appliedFilters.push(`Shade: ${shade}`);
    if (unit) appliedFilters.push(`Unit: ${unit}`);
    if (name) appliedFilters.push(`Name: ${name}`);
    if (mrp) appliedFilters.push(`MRP: ${mrp}`);
    if (articleNo) appliedFilters.push(`Article No: ${articleNo}`);
    if (hsnCode) appliedFilters.push(`HSN Code: ${hsnCode}`);
    if (gst) appliedFilters.push(`GST: ${gst}`);
    if (countSize) appliedFilters.push(`Count Size: ${countSize}`);
    if (description) appliedFilters.push(`Description: ${description}`);
    
    const filterSummary = appliedFilters.length > 0 ? `<p style="margin: 10px 0; padding: 10px; background: #e3f2fd; border-radius: 4px; color: #1976d2;"><strong>Filters Applied:</strong> ${appliedFilters.join(', ')}</p>` : '';
    
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>📦 Raw Materials</h3>
        ${filterSummary}
        
        <!-- Summary KPIs -->
        <div class="kpi-grid">
          <div class="kpi-item">
            <div class="kpi-label">Total Materials</div>
            <div class="kpi-value">${totalCount.toLocaleString()}</div>
            <div class="kpi-change">In System</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Active Materials</div>
            <div class="kpi-value">${activeCount.toLocaleString()}</div>
            <div class="kpi-change">Currently Active</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Categories</div>
            <div class="kpi-value">${categories.length}</div>
            <div class="kpi-change">Unique Categories</div>
          </div>
        </div>
        
        <!-- Raw Materials Table -->
        <div class="chart-container">
          <h4>📋 Raw Materials List</h4>
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Group Name</th>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Brand</th>
                  <th>Color</th>
                  <th>Unit</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${rawMaterials.results.map((material) => `
                  <tr>
                    <td>${material.groupName || 'N/A'}</td>
                    <td>${material.name || 'N/A'}</td>
                    <td>${material.type || 'N/A'}</td>
                    <td>${material.brand || 'N/A'}</td>
                    <td>${material.color || 'N/A'}</td>
                    <td>${material.unit || 'N/A'}</td>
                    <td>${material.status || 'N/A'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        
        ${generatePaginationHTML(currentPage, totalPages, totalCount, 'raw materials')}
        
        <p class="summary">Found ${totalCount.toLocaleString()} raw materials${rawMaterials.totalResults > rawMaterials.results.length ? ` (showing ${rawMaterials.results.length} of ${rawMaterials.totalResults} on page ${currentPage})` : ''} across ${categories.length} categories with ${activeCount} active items.</p>
        
        ${appliedFilters.length > 0 ? `<p style="margin-top: 10px; color: #666; font-size: 12px;">💡 Tip: Remove filters to see all raw materials. Try: "show me all raw materials" or "raw materials by [group/type/brand/color]"</p>` : ''}
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getRawMaterials:', error);
    return generateHTMLResponse('Error', `Failed to retrieve raw materials: ${error.message}`);
  }
};

/**
 * Get unique colors available in raw materials
 * @param {Object} params - Parameters
 * @returns {Promise<string>} HTML string with available colors
 */
export const getRawMaterialColors = async (params = {}) => {
  try {
    // Get all raw materials to extract unique colors
    const allMaterials = await rawMaterialService.queryRawMaterials({}, { limit: 10000 });
    
    // Extract unique colors
    const allColors = [...new Set(allMaterials.results?.map(m => m.color).filter(c => c && c !== 'N/A' && c.trim() !== '') || [])];
    allColors.sort(); // Sort alphabetically
    
    // Count materials per color
    const colorCounts = {};
    allMaterials.results?.forEach(m => {
      if (m.color && m.color !== 'N/A' && m.color.trim() !== '') {
        colorCounts[m.color] = (colorCounts[m.color] || 0) + 1;
      }
    });
    
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>🎨 Available Colors in Raw Materials</h3>
        
        <!-- Summary KPIs -->
        <div class="kpi-grid">
          <div class="kpi-item">
            <div class="kpi-label">Total Colors</div>
            <div class="kpi-value">${allColors.length}</div>
            <div class="kpi-change">Unique Colors</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Total Materials</div>
            <div class="kpi-value">${allMaterials.results?.length || 0}</div>
            <div class="kpi-change">In System</div>
          </div>
        </div>
        
        <!-- Colors List -->
        <div class="chart-container">
          <h4>📋 Available Colors</h4>
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Color</th>
                  <th>Materials Count</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                ${allColors.map((color) => `
                  <tr>
                    <td><strong style="text-transform: capitalize;">${color}</strong></td>
                    <td>${colorCounts[color] || 0}</td>
                    <td><button onclick="window.parent.postMessage({type: 'ai_tool_action', action: 'getRawMaterials', params: {color: '${color}'}}, '*')" style="background: #3b82f6; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 0.9em;">View Materials</button></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        
        <p class="summary">Found ${allColors.length} unique colors in raw materials. Click "View Materials" to see all materials in a specific color.</p>
        <p style="margin-top: 10px; color: #666; font-size: 12px;">💡 Tip: Ask me "raw materials in [color]" to see materials in a specific color, or click the buttons above.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getRawMaterialColors:', error);
    return generateHTMLResponse('Error', `Failed to retrieve raw material colors: ${error.message}`);
  }
};

/**
 * Get processes
 * @param {Object} params - Parameters
 * @returns {Promise<string>} HTML string with processes
 */
export const getProcesses = async (params = {}) => {
  try {
    const { limit = 50 } = params;
    
    const processes = await processService.queryProcesses({}, { limit: parseInt(limit) || 50 });
    
    if (!processes.results || processes.results.length === 0) {
      return generateHTMLResponse('No Processes Found', 'No processes found in the system.');
    }
    
    // Calculate summary statistics
    const totalCount = processes.totalResults || processes.results.length;
    const activeCount = processes.results.filter(p => p.status === 'Active' || p.status === 'active').length;
    const inactiveCount = processes.results.filter(p => p.status === 'Inactive' || p.status === 'inactive').length;
    
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>⚙️ Processes</h3>
        
        <!-- Summary KPIs -->
        <div class="kpi-grid">
          <div class="kpi-item">
            <div class="kpi-label">Total Processes</div>
            <div class="kpi-value">${totalCount.toLocaleString()}</div>
            <div class="kpi-change">In System</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Active Processes</div>
            <div class="kpi-value">${activeCount.toLocaleString()}</div>
            <div class="kpi-change">Currently Active</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Inactive Processes</div>
            <div class="kpi-value">${inactiveCount.toLocaleString()}</div>
            <div class="kpi-change">Not Active</div>
          </div>
        </div>
        
        <!-- Processes Table -->
        <div class="chart-container">
          <h4>📋 Processes List</h4>
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Process Name</th>
                  <th>Process Code</th>
                  <th>Description</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${processes.results.map((process) => `
                  <tr>
                    <td>${process.name || 'N/A'}</td>
                    <td>${process.processCode || 'N/A'}</td>
                    <td>${process.description || 'N/A'}</td>
                    <td>${process.status || 'N/A'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        
        <p class="summary">Found ${totalCount.toLocaleString()} processes${processes.totalResults > processes.results.length ? ` (showing ${processes.results.length} of ${processes.totalResults})` : ''} with ${activeCount} active and ${inactiveCount} inactive.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getProcesses:', error);
    return generateHTMLResponse('Error', `Failed to retrieve processes: ${error.message}`);
  }
};

/**
 * Get product attributes
 * @param {Object} params - Parameters
 * @returns {Promise<string>} HTML string with product attributes
 */
export const getProductAttributes = async (params = {}) => {
  try {
    const { limit = 50 } = params;
    
    const attributes = await productAttributeService.queryProductAttributes({}, { limit: parseInt(limit) || 50 });
    
    if (!attributes.results || attributes.results.length === 0) {
      return generateHTMLResponse('No Product Attributes Found', 'No product attributes found in the system.');
    }
    
    // Calculate summary statistics
    const totalCount = attributes.totalResults || attributes.results.length;
    const activeCount = attributes.results.filter(a => a.status === 'Active' || a.status === 'active').length;
    const inactiveCount = attributes.results.filter(a => a.status === 'Inactive' || a.status === 'inactive').length;
    const types = [...new Set(attributes.results.map(a => a.type).filter(Boolean))];
    
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>📋 Product Attributes</h3>
        
        <!-- Summary KPIs -->
        <div class="kpi-grid">
          <div class="kpi-item">
            <div class="kpi-label">Total Attributes</div>
            <div class="kpi-value">${totalCount.toLocaleString()}</div>
            <div class="kpi-change">In System</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Active Attributes</div>
            <div class="kpi-value">${activeCount.toLocaleString()}</div>
            <div class="kpi-change">Currently Active</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Attribute Types</div>
            <div class="kpi-value">${types.length}</div>
            <div class="kpi-change">Unique Types</div>
          </div>
        </div>
        
        <!-- Attributes Table -->
        <div class="chart-container">
          <h4>📋 Product Attributes List</h4>
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Attribute Name</th>
                  <th>Attribute Type</th>
                  <th>Description</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${attributes.results.map((attr) => `
                  <tr>
                    <td>${attr.name || 'N/A'}</td>
                    <td>${attr.type || 'N/A'}</td>
                    <td>${attr.description || 'N/A'}</td>
                    <td>${attr.status || 'N/A'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        
        <p class="summary">Found ${totalCount.toLocaleString()} product attributes${attributes.totalResults > attributes.results.length ? ` (showing ${attributes.results.length} of ${attributes.totalResults})` : ''} across ${types.length} types with ${activeCount} active items.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getProductAttributes:', error);
    return generateHTMLResponse('Error', `Failed to retrieve product attributes: ${error.message}`);
  }
};

/**
 * Get categories
 * @param {Object} params - Parameters
 * @returns {Promise<string>} HTML string with categories
 */
export const getCategories = async (params = {}) => {
  try {
    const { limit = 50 } = params;
    
    const categories = await categoryService.queryCategories({}, { limit: parseInt(limit) || 50 });
    
    if (!categories.results || categories.results.length === 0) {
      return generateHTMLResponse('No Categories Found', 'No categories found in the system.');
    }
    
    const totalCount = categories.totalResults || categories.results.length;
    const activeCount = categories.results.filter(c => c.status === 'Active' || c.status === 'active').length;
    const inactiveCount = categories.results.filter(c => c.status === 'Inactive' || c.status === 'inactive').length;
    
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>📁 Categories</h3>
        
        <div class="kpi-grid">
          <div class="kpi-item">
            <div class="kpi-label">Total Categories</div>
            <div class="kpi-value">${totalCount.toLocaleString()}</div>
            <div class="kpi-change">In System</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Active Categories</div>
            <div class="kpi-value">${activeCount.toLocaleString()}</div>
            <div class="kpi-change">Currently Active</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Inactive Categories</div>
            <div class="kpi-value">${inactiveCount.toLocaleString()}</div>
            <div class="kpi-change">Not Active</div>
          </div>
        </div>
        
        <div class="chart-container">
          <h4>📋 Categories List</h4>
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Category Name</th>
                  <th>Description</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${categories.results.map((category) => `
                  <tr>
                    <td>${category.name || 'N/A'}</td>
                    <td>${category.description || 'N/A'}</td>
                    <td>${category.status || 'N/A'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        
        <p class="summary">Found ${totalCount.toLocaleString()} categories${categories.totalResults > categories.results.length ? ` (showing ${categories.results.length} of ${categories.totalResults})` : ''} with ${activeCount} active and ${inactiveCount} inactive.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getCategories:', error);
    return generateHTMLResponse('Error', `Failed to retrieve categories: ${error.message}`);
  }
};

/**
 * Get yarn boxes
 * @param {Object} params - Parameters
 * @returns {Promise<string>} HTML string with yarn boxes
 */
export const getYarnBoxes = async (params = {}) => {
  try {
    const { limit = 50 } = params;
    
    const yarnBoxes = await yarnBoxService.queryYarnBoxes({});
    const boxes = Array.isArray(yarnBoxes) ? yarnBoxes : [];
    const limitedBoxes = boxes.slice(0, parseInt(limit) || 50);
    
    if (limitedBoxes.length === 0) {
      return generateHTMLResponse('No Yarn Boxes Found', 'No yarn boxes found in the system.');
    }
    
    const totalCount = boxes.length;
    const issuedCount = limitedBoxes.filter(b => b.coneData?.conesIssued === true).length;
    const notIssuedCount = limitedBoxes.filter(b => b.coneData?.conesIssued === false || !b.coneData?.conesIssued).length;
    
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>📦 Yarn Boxes</h3>
        
        <div class="kpi-grid">
          <div class="kpi-item">
            <div class="kpi-label">Total Boxes</div>
            <div class="kpi-value">${totalCount.toLocaleString()}</div>
            <div class="kpi-change">In System</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Cones Issued</div>
            <div class="kpi-value">${issuedCount.toLocaleString()}</div>
            <div class="kpi-change">Boxes with Issued Cones</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Cones Not Issued</div>
            <div class="kpi-value">${notIssuedCount.toLocaleString()}</div>
            <div class="kpi-change">Boxes Available</div>
          </div>
        </div>
        
        <div class="chart-container">
          <h4>📋 Yarn Boxes List</h4>
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Box ID</th>
                  <th>Yarn Name</th>
                  <th>PO Number</th>
                  <th>Shade Code</th>
                  <th>Storage Location</th>
                  <th>Cones Issued</th>
                </tr>
              </thead>
              <tbody>
                ${limitedBoxes.map((box) => `
                  <tr>
                    <td>${box.boxId || 'N/A'}</td>
                    <td>${box.yarnName || 'N/A'}</td>
                    <td>${box.poNumber || 'N/A'}</td>
                    <td>${box.shadeCode || 'N/A'}</td>
                    <td>${box.storageLocation || 'N/A'}</td>
                    <td>${box.coneData?.conesIssued ? 'Yes' : 'No'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        
        <p class="summary">Found ${totalCount.toLocaleString()} yarn boxes${totalCount > limitedBoxes.length ? ` (showing ${limitedBoxes.length} of ${totalCount})` : ''} with ${issuedCount} having cones issued and ${notIssuedCount} available.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getYarnBoxes:', error);
    return generateHTMLResponse('Error', `Failed to retrieve yarn boxes: ${error.message}`);
  }
};

/**
 * Get yarn cones
 * @param {Object} params - Parameters
 * @returns {Promise<string>} HTML string with yarn cones
 */
export const getYarnCones = async (params = {}) => {
  try {
    const { limit = 50 } = params;
    
    const yarnCones = await yarnConeService.queryYarnCones({});
    const cones = Array.isArray(yarnCones) ? yarnCones : [];
    const limitedCones = cones.slice(0, parseInt(limit) || 50);
    
    if (limitedCones.length === 0) {
      return generateHTMLResponse('No Yarn Cones Found', 'No yarn cones found in the system.');
    }
    
    const totalCount = cones.length;
    const issuedCount = limitedCones.filter(c => c.issueStatus === 'issued').length;
    const availableCount = limitedCones.filter(c => c.issueStatus !== 'issued' || !c.issueStatus).length;
    
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>🧵 Yarn Cones</h3>
        
        <div class="kpi-grid">
          <div class="kpi-item">
            <div class="kpi-label">Total Cones</div>
            <div class="kpi-value">${totalCount.toLocaleString()}</div>
            <div class="kpi-change">In System</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Issued Cones</div>
            <div class="kpi-value">${issuedCount.toLocaleString()}</div>
            <div class="kpi-change">Already Issued</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Available Cones</div>
            <div class="kpi-value">${availableCount.toLocaleString()}</div>
            <div class="kpi-change">Available for Issue</div>
          </div>
        </div>
        
        <div class="chart-container">
          <h4>📋 Yarn Cones List</h4>
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Barcode</th>
                  <th>Yarn Name</th>
                  <th>Box ID</th>
                  <th>PO Number</th>
                  <th>Issue Status</th>
                  <th>Storage ID</th>
                </tr>
              </thead>
              <tbody>
                ${limitedCones.map((cone) => `
                  <tr>
                    <td>${cone.barcode || 'N/A'}</td>
                    <td>${cone.yarnName || 'N/A'}</td>
                    <td>${cone.boxId || 'N/A'}</td>
                    <td>${cone.poNumber || 'N/A'}</td>
                    <td>${cone.issueStatus || 'Available'}</td>
                    <td>${cone.coneStorageId || 'N/A'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        
        <p class="summary">Found ${totalCount.toLocaleString()} yarn cones${totalCount > limitedCones.length ? ` (showing ${limitedCones.length} of ${totalCount})` : ''} with ${issuedCount} issued and ${availableCount} available.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getYarnCones:', error);
    return generateHTMLResponse('Error', `Failed to retrieve yarn cones: ${error.message}`);
  }
};

/**
 * Get storage slots
 * @param {Object} params - Parameters
 * @returns {Promise<string>} HTML string with storage slots
 */
export const getStorageSlots = async (params = {}) => {
  try {
    const { limit = 100, page = 1 } = params;
    const currentPage = parseInt(page) || 1;
    const pageLimit = parseInt(limit) || 100;
    
    const storageSlots = await storageSlotService.queryStorageSlots({ 
      limit: pageLimit,
      page: currentPage
    });
    
    if (!storageSlots.results || storageSlots.results.length === 0) {
      return generateHTMLResponse('No Storage Slots Found', 'No storage slots found in the system.');
    }
    
    const totalCount = storageSlots.totalResults || storageSlots.results.length;
    const totalPages = storageSlots.totalPages || Math.ceil(totalCount / pageLimit);
    const activeCount = storageSlots.results.filter(s => s.isActive === true).length;
    const inactiveCount = storageSlots.results.filter(s => s.isActive === false).length;
    const zones = [...new Set(storageSlots.results.map(s => s.zoneCode).filter(Boolean))];
    
    // Generate pagination HTML
    const paginationHTML = generatePaginationHTML(currentPage, totalPages, totalCount, 'storage slots');
    
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>🏢 Storage Slots</h3>
        
        <div class="kpi-grid">
          <div class="kpi-item">
            <div class="kpi-label">Total Slots</div>
            <div class="kpi-value">${totalCount.toLocaleString()}</div>
            <div class="kpi-change">In System</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Active Slots</div>
            <div class="kpi-value">${activeCount.toLocaleString()}</div>
            <div class="kpi-change">Currently Active</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Zones</div>
            <div class="kpi-value">${zones.length}</div>
            <div class="kpi-change">Storage Zones</div>
          </div>
        </div>
        
        <div class="chart-container">
          <h4>📋 Storage Slots List ${totalPages > 1 ? `(Page ${currentPage} of ${totalPages})` : ''}</h4>
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Zone</th>
                  <th>Shelf</th>
                  <th>Floor</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${storageSlots.results.map((slot) => `
                  <tr>
                    <td>${slot.zoneCode || 'N/A'}</td>
                    <td>${slot.shelfNumber || 'N/A'}</td>
                    <td>${slot.floorNumber || 'N/A'}</td>
                    <td>${slot.isActive ? 'Active' : 'Inactive'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        
        ${paginationHTML}
        
        <p class="summary">Found ${totalCount.toLocaleString()} storage slots${totalPages > 1 ? ` (showing page ${currentPage} of ${totalPages}, ${storageSlots.results.length} items per page)` : ''} across ${zones.length} zones with ${activeCount} active slots.</p>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getStorageSlots:', error);
    return generateHTMLResponse('Error', `Failed to retrieve storage slots: ${error.message}`);
  }
};

/**
 * Get production orders
 * @param {Object} params - Parameters with optional orderId or status
 * @returns {Promise<string>} HTML string with production orders
 */
export const getProductionOrders = async (params = {}) => {
  try {
    const { orderId, status, limit = 20 } = params;
    
    // Note: This is a placeholder - adjust based on actual production service API
    // You may need to check the production service structure
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>🏭 Production Orders</h3>
        <div class="response-content">
          <p>Production order data is being integrated. Please check the production dashboard for detailed information.</p>
          <p>You can ask: "show me production dashboard" for comprehensive production data.</p>
        </div>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getProductionOrders:', error);
    return generateHTMLResponse('Error', `Failed to retrieve production orders: ${error.message}`);
  }
};

/**
 * Get production dashboard
 * @param {Object} params - Parameters
 * @returns {Promise<string>} HTML string with production dashboard
 */
export const getProductionDashboard = async (params = {}) => {
  try {
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>🏭 Production Dashboard</h3>
        <div class="response-content">
          <p>Production dashboard data is being integrated. This feature will provide comprehensive production analytics including:</p>
          <ul>
            <li>Order status tracking</li>
            <li>Floor-wise production statistics</li>
            <li>Quality metrics</li>
            <li>Efficiency reports</li>
          </ul>
          <p>Please use the production module in the application for detailed production data.</p>
        </div>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getProductionDashboard:', error);
    return generateHTMLResponse('Error', `Failed to retrieve production dashboard: ${error.message}`);
  }
};

/**
 * Get orders
 * @param {Object} params - Parameters with optional orderId or status
 * @returns {Promise<string>} HTML string with orders
 */
export const getOrders = async (params = {}) => {
  try {
    const { orderId, status, limit = 20 } = params;
    
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>📋 Orders</h3>
        <div class="response-content">
          <p>Order data is being integrated. This feature will provide order information including:</p>
          <ul>
            <li>Order status</li>
            <li>Order details</li>
            <li>Order tracking</li>
          </ul>
          <p>Please use the orders module in the application for detailed order data.</p>
        </div>
      </div>
    `;
    
    return html;
  } catch (error) {
    console.error('Error in getOrders:', error);
    return generateHTMLResponse('Error', `Failed to retrieve orders: ${error.message}`);
  }
};

/**
 * Get sales data with filters
 * @param {Object} params - Parameters (city, category, productName, storeName, dateFrom, dateTo, page, limit)
 * @param {Object} [options] - { sessionId } for persisting params for pagination
 * @returns {Promise<{ html: string, salesDataPagination?: { currentPage, totalPages, totalCount } }>}
 */
export const getSalesData = async (params = {}, options = {}) => {
  try {
    console.log(`[getSalesData] Called with params:`, JSON.stringify(params));
    let { limit = 50, page = 1, city, category, productName, storeName, dateFrom, dateTo, period, sortBy, mrpMin, mrpMax } = params;
    // "mumbai store" / "delhi store" etc. usually means city only — avoid treating as store name
    if (storeName && city && typeof storeName === 'string') {
      const cityLower = (city || '').toString().trim().toLowerCase();
      const storeLower = storeName.trim().toLowerCase();
      if (storeLower === `${cityLower} store` || storeLower === `${cityLower} stores`) {
        console.log(`[getSalesData] Treating "${storeName}" as city-only, using city filter only`);
        storeName = undefined;
      }
    }
    const currentPage = parseInt(page) || 1;
    let pageLimit = Math.min(parseInt(limit) || 50, 200);

    // Resolve period to dateFrom/dateTo when no explicit dates given
    if ((!dateFrom && !dateTo) && period && typeof period === 'string') {
      const now = new Date();
      const p = period.toLowerCase().trim();
      if (p === 'today') {
        dateFrom = new Date(now);
        dateFrom.setHours(0, 0, 0, 0);
        dateTo = new Date(now);
        dateTo.setHours(23, 59, 59, 999);
      } else if (p === 'yesterday') {
        dateFrom = new Date(now);
        dateFrom.setDate(dateFrom.getDate() - 1);
        dateFrom.setHours(0, 0, 0, 0);
        dateTo = new Date(dateFrom);
        dateTo.setHours(23, 59, 59, 999);
      } else if (p === 'last week' || p === 'lastweek') {
        dateTo = new Date(now);
        dateFrom = new Date(now);
        dateFrom.setDate(dateFrom.getDate() - 7);
      } else if (p === 'last month' || p === 'lastmonth') {
        dateTo = new Date(now);
        dateFrom = new Date(now);
        dateFrom.setMonth(dateFrom.getMonth() - 1);
      } else if (p === 'last 30 days' || p === 'last30days') {
        dateTo = new Date(now);
        dateFrom = new Date(now);
        dateFrom.setDate(dateFrom.getDate() - 30);
      }
      if (dateFrom && dateTo && !(dateFrom instanceof Date)) dateFrom = dateFrom.toISOString ? dateFrom : new Date(dateFrom);
      if (dateTo && !(dateTo instanceof Date)) dateTo = dateTo.toISOString ? dateTo : new Date(dateTo);
    }

    console.log(`[getSalesData] Parsed params - city: ${city}, page: ${currentPage}, limit: ${pageLimit}, dateFrom: ${dateFrom}, dateTo: ${dateTo}`);

    // Build filter
    const filter = {};
    
    // Check city first to provide better error messages
    if (city) {
      const cityName = city.trim();
      console.log(`[getSalesData] Searching for stores in city: ${cityName}`);
      // Check if stores exist in this city (case-insensitive search)
      const storesInCity = await Store.find({ city: { $regex: cityName, $options: 'i' } }).select('_id storeName city').lean();
      console.log(`[getSalesData] Found ${storesInCity.length} stores in ${cityName}`);
      if (storesInCity.length === 0) {
        // Try to find similar city names for suggestions
        const allCities = await Store.distinct('city');
        const similarCities = allCities.filter(c => 
          c && c.toLowerCase().includes(cityName.toLowerCase()) || 
          cityName.toLowerCase().includes(c.toLowerCase())
        ).slice(0, 5);
        
        let suggestionMsg = `No stores found in "${cityName}".`;
        if (similarCities.length > 0) {
          suggestionMsg += ` Did you mean: ${similarCities.join(', ')}?`;
        } else {
          suggestionMsg += ` Available cities include: ${allCities.slice(0, 10).join(', ')}${allCities.length > 10 ? '...' : ''}`;
        }
        
        return generateHTMLResponse('No Stores Found', suggestionMsg);
      }
      filter.city = cityName;
      console.log(`[getSalesData] Set filter.city = ${cityName}`);
    }
    
    if (category) {
      filter.category = category;
      console.log(`[getSalesData] Set filter.category = ${category}`);
    }
    
    if (productName) {
      const searchTerm = productName.trim();
      console.log(`[getSalesData] Searching for product: "${searchTerm}"`);
      
      // Search across multiple fields: name, softwareCode, styleCode, internalCode, etc.
      const productSearchFilter = {
        $or: [
          { name: { $regex: searchTerm, $options: 'i' } },
          { softwareCode: { $regex: searchTerm, $options: 'i' } },
          { styleCode: { $regex: searchTerm, $options: 'i' } },
          { internalCode: { $regex: searchTerm, $options: 'i' } },
          { vendorCode: { $regex: searchTerm, $options: 'i' } },
          { factoryCode: { $regex: searchTerm, $options: 'i' } },
          { eanCode: { $regex: searchTerm, $options: 'i' } },
          { description: { $regex: searchTerm, $options: 'i' } }
        ]
      };
      
      // Try to find exact or partial match
      let product = await Product.findOne(productSearchFilter).select('_id name softwareCode styleCode').lean();
      
      if (!product) {
        // If no match found, try splitting the search term and searching for parts
        const searchParts = searchTerm.split(/\s+/).filter(part => part.length > 2);
        if (searchParts.length > 1) {
          const partialFilter = {
            $or: searchParts.map(part => ({
              $or: [
                { name: { $regex: part, $options: 'i' } },
                { softwareCode: { $regex: part, $options: 'i' } },
                { styleCode: { $regex: part, $options: 'i' } }
              ]
            }))
          };
          product = await Product.findOne(partialFilter).select('_id name softwareCode styleCode').lean();
        }
      }
      
      if (product) {
        filter.materialCode = product._id;
        console.log(`[getSalesData] Found product: ${product.name || product.softwareCode || product.styleCode} (ID: ${product._id})`);
      } else {
        // Provide suggestions for similar product names
        const allProducts = await Product.find({})
          .select('name softwareCode styleCode')
          .limit(50)
          .lean();
        
        // Find products with similar names
        const searchLower = searchTerm.toLowerCase();
        const suggestions = allProducts
          .filter(p => {
            const name = (p.name || '').toLowerCase();
            const code = (p.softwareCode || p.styleCode || '').toLowerCase();
            return name.includes(searchLower) || 
                   searchLower.includes(name) ||
                   code.includes(searchLower) ||
                   name.split(/\s+/).some(word => word.startsWith(searchLower.substring(0, 3))) ||
                   searchTerm.split(/\s+/).some(word => name.includes(word.toLowerCase()));
          })
          .slice(0, 5)
          .map(p => p.name || p.softwareCode || p.styleCode || 'Unknown');
        
        let errorMsg = `Product "${productName}" not found in the system.`;
        if (suggestions.length > 0) {
          errorMsg += ` Did you mean: ${suggestions.join(', ')}?`;
        } else {
          errorMsg += ` Try searching with product code or a different name.`;
        }
        
        return generateHTMLResponse('Product Not Found', errorMsg);
      }
    }
    
    if (storeName) {
      // Find store by name or ID
      const store = await Store.findOne({
        $or: [
          { storeName: { $regex: storeName, $options: 'i' } },
          { storeId: { $regex: storeName, $options: 'i' } }
        ]
      }).select('_id').lean();
      
      if (store) {
        filter.plant = store._id;
        console.log(`[getSalesData] Found store, set filter.plant`);
      } else {
        return generateHTMLResponse('Store Not Found', `Store "${storeName}" not found in the system.`);
      }
    }
    
    if (dateFrom) {
      filter.dateFrom = dateFrom instanceof Date ? dateFrom.toISOString() : dateFrom;
      console.log(`[getSalesData] Set filter.dateFrom = ${filter.dateFrom}`);
    }

    if (dateTo) {
      filter.dateTo = dateTo instanceof Date ? dateTo.toISOString() : dateTo;
      console.log(`[getSalesData] Set filter.dateTo = ${filter.dateTo}`);
    }

    // MRP filter: "mrp above 299", "mrp below 500", "products with MRP > 299"
    if (mrpMin != null && mrpMin !== '') {
      const num = Number(mrpMin);
      if (!Number.isNaN(num)) {
        filter.mrp = filter.mrp || {};
        filter.mrp.$gte = num;
        console.log(`[getSalesData] Set filter.mrp.$gte = ${num}`);
      }
    }
    if (mrpMax != null && mrpMax !== '') {
      const num = Number(mrpMax);
      if (!Number.isNaN(num)) {
        filter.mrp = filter.mrp || {};
        filter.mrp.$lte = num;
        console.log(`[getSalesData] Set filter.mrp.$lte = ${num}`);
      }
    }

    const sortField = (sortBy && typeof sortBy === 'string') ? sortBy.split(':')[0] : 'date';
    const sortOrder = (sortBy && sortBy.toLowerCase().includes('asc')) ? 'asc' : 'desc';
    console.log(`[getSalesData] Calling salesService.querySales with filter:`, JSON.stringify(filter));
    const sales = await salesService.querySales(filter, {
      limit: pageLimit,
      page: currentPage,
      sortBy: sortField,
      sortOrder
    });
    console.log(`[getSalesData] Query returned ${sales.results?.length || 0} results, total: ${sales.totalResults || 0}`);
    
    if (!sales.results || sales.results.length === 0) {
      // Provide more specific error message
      let errorMsg = 'No sales records found matching the criteria.';
      let suggestions = [];
      
      if (city) {
        // Re-check stores to provide helpful message
        const storesInCity = await Store.find({ city: { $regex: city.trim(), $options: 'i' } }).select('storeName city').limit(5).lean();
        if (storesInCity.length > 0) {
          errorMsg = `No sales records found for stores in "${city}". Found ${storesInCity.length} store(s) in this city but no sales data.`;
          suggestions.push(`Stores found: ${storesInCity.map(s => s.storeName || s.storeId).join(', ')}`);
          suggestions.push('Try a different date range or check if sales data has been imported for these stores.');
        } else {
          errorMsg = `No stores found in "${city}". Please check the city name spelling.`;
          suggestions.push('Try searching with different city names like: Mumbai, Delhi, Bangalore, etc.');
        }
      } else if (productName) {
        // Check if product exists but has no sales
        const productCheck = await Product.findOne({
          $or: [
            { name: { $regex: productName.trim(), $options: 'i' } },
            { softwareCode: { $regex: productName.trim(), $options: 'i' } },
            { styleCode: { $regex: productName.trim(), $options: 'i' } }
          ]
        }).select('name softwareCode').lean();
        
        if (productCheck) {
          errorMsg = `Product "${productCheck.name || productCheck.softwareCode || productName}" exists in the catalog but has no sales records.`;
          suggestions.push('This product may not have been sold yet, or sales data may not have been imported.');
          suggestions.push('Try searching for a different product or check if sales data has been imported.');
        } else {
          errorMsg = `No sales records found for product "${productName}".`;
          suggestions.push('Try searching with a different product name or check the product catalog.');
        }
      } else if (storeName) {
        errorMsg = `No sales records found for store "${storeName}".`;
        suggestions.push('Try searching with store ID or a different store name.');
      } else if (dateFrom || dateTo) {
        errorMsg = `No sales records found for the specified date range.`;
        suggestions.push('Try adjusting the date range or remove date filters to see all sales data.');
      } else {
        suggestions.push('Try adding filters like city, product name, or date range.');
      }
      
      const suggestionsHTML = suggestions.length > 0 ? `<ul style="margin-top: 10px; padding-left: 20px;">${suggestions.map(s => `<li>${s}</li>`).join('')}</ul>` : '';
      
      return generateHTMLResponse('No Sales Data Found', `${errorMsg}${suggestionsHTML}`);
    }
    
    const totalCount = sales.totalResults || 0;
    const totalPages = sales.totalPages || 1;
    
    // Calculate summary statistics
    const totalQuantity = sales.results.reduce((sum, sale) => sum + (sale.quantity || 0), 0);
    const totalNSV = sales.results.reduce((sum, sale) => sum + (sale.nsv || 0), 0);
    const totalGSV = sales.results.reduce((sum, sale) => sum + (sale.gsv || 0), 0);
    const totalDiscount = sales.results.reduce((sum, sale) => sum + (sale.discount || 0), 0);
    
    const filterInfo = [];
    if (city) filterInfo.push(`City: ${city}`);
    if (category) filterInfo.push(`Category: ${category}`);
    if (productName) filterInfo.push(`Product: ${productName}`);
    if (storeName) filterInfo.push(`Store: ${storeName}`);
    if (dateFrom || dateTo) {
      const dateRange = [];
      if (dateFrom) dateRange.push(`From: ${new Date(dateFrom).toLocaleDateString()}`);
      if (dateTo) dateRange.push(`To: ${new Date(dateTo).toLocaleDateString()}`);
      filterInfo.push(dateRange.join(' '));
    }
    if (filter.mrp) {
      if (filter.mrp.$gte != null && filter.mrp.$lte != null) {
        filterInfo.push(`MRP: ₹${filter.mrp.$gte}–₹${filter.mrp.$lte}`);
      } else if (filter.mrp.$gte != null) {
        filterInfo.push(`MRP ≥ ₹${filter.mrp.$gte}`);
      } else if (filter.mrp.$lte != null) {
        filterInfo.push(`MRP ≤ ₹${filter.mrp.$lte}`);
      }
    }
    const filterText = filterInfo.length > 0 ? ` (Filtered: ${filterInfo.join(', ')})` : '';
    
    const html = AI_TOOL_STYLES + `
      <div class="ai-tool-response">
        <h3>💰 Sales Data${filterText}</h3>
        
        <div class="kpi-grid">
          <div class="kpi-item">
            <div class="kpi-label">Total Records</div>
            <div class="kpi-value">${totalCount.toLocaleString()}</div>
            <div class="kpi-change">${filterInfo.length > 0 ? 'Filtered Results' : 'All Sales'}</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Total Quantity</div>
            <div class="kpi-value">${totalQuantity.toLocaleString()}</div>
            <div class="kpi-change">Units Sold</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Total NSV</div>
            <div class="kpi-value">₹${totalNSV.toLocaleString()}</div>
            <div class="kpi-change">Net Sales Value</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Total GSV</div>
            <div class="kpi-value">₹${totalGSV.toLocaleString()}</div>
            <div class="kpi-change">Gross Sales Value</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">Total Discount</div>
            <div class="kpi-value">₹${totalDiscount.toLocaleString()}</div>
            <div class="kpi-change">Discount Amount</div>
          </div>
        </div>
        
        <div class="chart-container">
          <h4>📊 Sales Records ${totalPages > 1 ? `(Page ${currentPage} of ${totalPages})` : ''}</h4>
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Store</th>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Quantity</th>
                  <th>MRP</th>
                  <th>Discount</th>
                  <th>GSV</th>
                  <th>NSV</th>
                  <th>Tax</th>
                </tr>
              </thead>
              <tbody>
                ${sales.results.map((sale) => `
                  <tr>
                    <td>${sale.date ? new Date(sale.date).toLocaleDateString() : 'N/A'}</td>
                    <td>${sale.plant?.storeName || sale.plant?.storeId || 'N/A'}</td>
                    <td>${sale.materialCode?.name || sale.materialCode?.styleCode || 'N/A'}</td>
                    <td>${sale.materialCode?.category?.name || 'Uncategorized'}</td>
                    <td>${(sale.quantity || 0).toLocaleString()}</td>
                    <td>₹${(sale.mrp || 0).toLocaleString()}</td>
                    <td>₹${(sale.discount || 0).toLocaleString()}</td>
                    <td>₹${(sale.gsv || 0).toLocaleString()}</td>
                    <td>₹${(sale.nsv || 0).toLocaleString()}</td>
                    <td>₹${(sale.totalTax || 0).toLocaleString()}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        
        <p class="summary">Found ${totalCount.toLocaleString()} sales records${filterText}${totalPages > 1 ? ` (showing page ${currentPage} of ${totalPages}, ${sales.results.length} items per page)` : ''}.</p>
        ${totalPages > 1 ? `
        <div class="sales-pagination" style="margin-top: 1em; padding: 0.75em; border-radius: 8px; background: var(--bg-secondary, #1e293b); display: flex; flex-wrap: wrap; align-items: center; gap: 0.5em;">
          <span style="margin-right: 0.5em; color: var(--text-secondary, #94a3b8); font-size: 0.9em;">Page ${currentPage} of ${totalPages}</span>
          <span style="color: var(--text-muted, #64748b); font-size: 0.85em;">Reply with <strong>page 2</strong>, <strong>next page</strong>, or <strong>previous page</strong> to navigate.</span>
        </div>
        ` : ''}
      </div>
    `;

    const out = { html };
    if (totalPages > 1) {
      out.salesDataPagination = { currentPage, totalPages, totalCount };
    }
    if (options?.sessionId && totalCount > 0) {
      setAgentFlowSession(options.sessionId, 'sales_data', {
        salesDataParams: { city, category, productName, storeName, dateFrom: filter.dateFrom, dateTo: filter.dateTo, limit: pageLimit, mrpMin, mrpMax },
        currentPage,
        totalPages
      });
    }
    return out;
  } catch (error) {
    console.error('Error in getSalesData:', error);
    return { html: generateHTMLResponse('Error', `Failed to retrieve sales data: ${error.message}`) };
  }
};

// Pending confirmation guardrails for destructive/update actions (yes/no)
const PENDING_CONFIRM_TTL_MS = 5 * 60 * 1000; // 5 minutes
const pendingConfirmations = new Map();

const getPendingConfirmation = (sessionId) => {
  if (!sessionId) return null;
  const entry = pendingConfirmations.get(sessionId);
  if (!entry) return null;
  if (Date.now() - entry.at > PENDING_CONFIRM_TTL_MS) {
    pendingConfirmations.delete(sessionId);
    return null;
  }
  return entry;
};

const setPendingConfirmation = (sessionId, data) => {
  if (!sessionId) return;
  pendingConfirmations.set(sessionId, { ...data, at: Date.now() });
};

const clearPendingConfirmation = (sessionId) => {
  if (sessionId) pendingConfirmations.delete(sessionId);
};

// Agent flow session: remember which flow the user is in (edit PO, create PO, update status, etc.) so we don't fetch unrelated data (e.g. raw materials when in yarn add-item)
const AGENT_FLOW_TTL_MS = 15 * 60 * 1000; // 15 minutes
const agentFlowBySession = new Map();

/**
 * Get stored agent flow for this session (so next message stays in same flow).
 * @param {string} sessionId
 * @returns {{ flow: string, context: Object } | null} e.g. { flow: 'edit_po', context: { editOrderPo: {...} } }
 */
export const getAgentFlowSession = (sessionId) => {
  if (!sessionId) return null;
  const entry = agentFlowBySession.get(sessionId);
  if (!entry) return null;
  if (Date.now() - (entry.at || 0) > AGENT_FLOW_TTL_MS) {
    agentFlowBySession.delete(sessionId);
    return null;
  }
  return entry;
};

/**
 * Store current flow and context for this session (edit PO, create PO, update status choice).
 * @param {string} sessionId
 * @param {string} flow - 'edit_po' | 'create_po' | 'update_status_choice'
 * @param {Object} context - { editOrderPo?, placeOrderContext?, awaitingFollowUp?, orderRefForStatus? }
 */
export const setAgentFlowSession = (sessionId, flow, context) => {
  if (!sessionId || !flow) return;
  agentFlowBySession.set(sessionId, { flow, context: context || {}, at: Date.now() });
};

/** Clear stored flow when user completes or cancels (e.g. done editing, order placed). */
export const clearAgentFlowSession = (sessionId) => {
  if (sessionId) agentFlowBySession.delete(sessionId);
};

/** Set pending "place yarn order" confirmation so that when user says "yes" we create the PO */
export const setPendingPlaceOrderConfirmation = (sessionId, { placeOrderContext }) => {
  if (!sessionId || !placeOrderContext) return;
  setPendingConfirmation(sessionId, { action: 'placeYarnOrder', params: { placeOrderContext }, label: 'Place yarn purchase order' });
};

const CONFIRM_VARIANTS = ['yes', 'y', 'confirm'];
const CANCEL_VARIANTS = ['no', 'n', 'cancel'];

/**
 * Resolve pending confirmation when user types yes/no (or y/n, confirm/cancel).
 * If there is a pending confirmation but the message is unclear, re-prompt without clearing.
 * @param {string} sessionId - Chat session id
 * @param {string} message - User message
 * @returns {{ resolved: boolean, response?: string }} If resolved, response is HTML
 */
export const resolvePendingConfirmation = async (sessionId, message) => {
  const pending = getPendingConfirmation(sessionId);
  if (!pending) return { resolved: false };
  const normalized = String(message).toLowerCase().trim();
  const isConfirm = CONFIRM_VARIANTS.includes(normalized);
  const isCancel = CANCEL_VARIANTS.includes(normalized);
  if (!isConfirm && !isCancel) {
    return {
      resolved: true,
      response: generateHTMLResponse(
        'Confirm',
        '<p>Please type <strong>yes</strong> to confirm or <strong>no</strong> to cancel.</p>'
      )
    };
  }
  clearPendingConfirmation(sessionId);
  if (isConfirm) {
    if (pending.action === 'placeYarnOrder' && pending.params?.placeOrderContext) {
      try {
        const ctx = pending.params.placeOrderContext;
        const { created, total, poItems } = await createPurchaseOrderFromPlaceContext(ctx);
        const response = generateHTMLResponse('Order Placed', `Purchase order <strong>${created.poNumber}</strong> created successfully with ${poItems.length} item(s). Total: ₹${total.toLocaleString()}. Opening the form so you can see it.`);
        const agentJobId = `JOB_${Date.now()}`;
        try {
          const purchaseDate = new Date().toISOString().slice(0, 10);
          const deliveryDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
          const agentContext = {
            order: {
              purchaseDate,
              supplierName: ctx.supplierName || '',
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
            jobId: agentJobId,
            flowKey: 'purchase.po.create.ui',
            refType: 'PO',
            refId: created.poNumber,
            context: agentContext
          });
          await agentUiFlowService.startUiFlow(agentJobId);
        } catch (agentErr) {
          console.warn('Agent UI flow create/start failed (order still placed):', agentErr?.message);
        }
        if (!agentJobId) console.warn('[aiToolService] placeYarnOrder success but agentJobId missing');
        return { resolved: true, response, poNumber: created.poNumber, agentJobId };
      } catch (err) {
        return { resolved: true, response: generateHTMLResponse('Error', err.message || 'Failed to place order.') };
      }
    }
    try {
      const response = await executeAITool(
        { action: pending.action, params: pending.params },
        { skipConfirmation: true }
      );
      return { resolved: true, response };
    } catch (err) {
      return { resolved: true, response: generateHTMLResponse('Error', err.message || 'Action failed.') };
    }
  }
  return {
    resolved: true,
    response: generateHTMLResponse('Cancelled', `${pending.label || 'Action'} was cancelled. Type a new command to continue.`)
  };
};

/**
 * Execute AI tool based on detected intent
 * @param {Object} intent - Detected intent object
 * @param {Object} options - { sessionId?: string, skipConfirmation?: boolean }
 * @returns {Promise<string>} HTML response
 */
export const executeAITool = async (intent, options = {}) => {
  const { sessionId, skipConfirmation } = options;
  const idOrPo = intent.params?.purchaseOrderId || intent.params?.poNumber || intent.params?.orderId;
  const hasOrder = !!idOrPo;
  const statusRaw = intent.params?.status_code || intent.params?.status;
  const hasValidStatus = intent.action === 'updateYarnPurchaseOrderStatus' ? isValidStatusForConfirmation(statusRaw) : true;
  const needsConfirmation = sessionId && !skipConfirmation && (
    (intent.action === 'deleteYarnPurchaseOrder' && hasOrder) ||
    (intent.action === 'updateYarnPurchaseOrderStatus' && hasOrder && hasValidStatus)
  );

  if (needsConfirmation) {
    const idOrPoLabel = idOrPo || 'this order';
    const statusCode = intent.params?.status_code || intent.params?.status;
    const statusLabel = statusCode ? String(statusCode).replace(/_/g, ' ') : '';
    const label = intent.action === 'deleteYarnPurchaseOrder'
      ? `Delete purchase order ${idOrPoLabel}`
      : `Update status of purchase order ${idOrPoLabel} to ${statusLabel}`;
    setPendingConfirmation(sessionId, { action: intent.action, params: intent.params, label });
    const actionVerb = intent.action === 'deleteYarnPurchaseOrder' ? 'delete' : 'update the status of';
    const confirmDetail = intent.action === 'updateYarnPurchaseOrderStatus' && statusLabel
      ? ` to <strong>${statusLabel}</strong>`
      : '';
    return generateHTMLResponse(
      'Confirm',
      `<p><strong>Are you sure</strong> you want to ${actionVerb} <strong>${idOrPoLabel}</strong>${confirmDetail}?</p><p>Type <strong>yes</strong> to confirm or <strong>no</strong> to cancel.</p>`
    );
  }

  try {
    switch (intent.action) {
      // Existing actions
      case 'getTopProducts':
        return await getTopProducts(intent.params.city);
      case 'getProductCount':
        return await getProductCount();
      case 'getProductsList':
        return await getProductsList(intent.params);
      case 'getStoresList':
        return await getStoresList(intent.params);
      case 'getTopProductsInCity':
        return await getTopProductsInCity(intent.params.city);
      case 'getSalesReport':
        return await getSalesReport(intent.params);
      case 'getAnalyticsDashboard':
        return await getAnalyticsDashboard(intent.params);
      case 'getBrandPerformance':
        return await getBrandPerformance(intent.params);
      case 'getStoreAnalysis':
        return await getStoreAnalysis(intent.params);
      case 'getProductForecast':
        return await getProductForecast(intent.params);
      case 'getCapabilities':
        return await getCapabilities();
      case 'getProductAnalysis':
        return await getProductAnalysis(intent.params);
      case 'getStoreAnalysisByName':
        return await getStoreAnalysisByName(intent.params);
      // New machine actions
      case 'getMachineStatistics':
        return await getMachineStatistics();
      case 'getMachinesByStatus':
        return await getMachinesByStatus(intent.params);
      case 'getMachinesByFloor':
        return await getMachinesByFloor(intent.params);
      // New yarn actions
      case 'getYarnCatalog':
        return await getYarnCatalog(intent.params);
      case 'getYarnInventory':
        return await getYarnInventory(intent.params);
      case 'getLiveInventory':
        return await getLiveInventory(intent.params);
      case 'getRecentPOStatus':
        return await getRecentPOStatus(intent.params);
      case 'getYarnTransactions':
        return await getYarnTransactions(intent.params);
      case 'getYarnIssue':
        return await getYarnIssue(intent.params);
      case 'getYarnReturn':
        return await getYarnReturn(intent.params);
      case 'getYarnRequisitions':
        return await getYarnRequisitions(intent.params);
      case 'getYarnPurchaseOrders':
        return await getYarnPurchaseOrders(intent.params);
      case 'getYarnPurchaseOrderById':
        return await getYarnPurchaseOrderById(intent.params);
      case 'editYarnPurchaseOrder':
        return await editYarnPurchaseOrder(intent.params);
      case 'createYarnPurchaseOrder':
        return await createYarnPurchaseOrder(intent.params);
      case 'updateYarnPurchaseOrderStatus':
        return await updateYarnPurchaseOrderStatus(intent.params);
      case 'deleteYarnPurchaseOrder':
        return await deleteYarnPurchaseOrder(intent.params);
      case 'getYarnTypes':
        return await getYarnTypes(intent.params);
      case 'getYarnSuppliers':
        return await getYarnSuppliers(intent.params);
      case 'getYarnCountSizes':
        return await getYarnCountSizes(intent.params);
      case 'getYarnColors':
        return await getYarnColors(intent.params);
      case 'getSuppliersByYarnColour':
        return await getSuppliersByYarnColour(intent.params);
      case 'getYarnBlends':
        return await getYarnBlends(intent.params);
      // Raw Materials, Processes, Attributes
      case 'getRawMaterials':
        return await getRawMaterials(intent.params);
      case 'getRawMaterialColors':
        return await getRawMaterialColors(intent.params);
      case 'getProcesses':
        return await getProcesses(intent.params);
      case 'getProductAttributes':
        return await getProductAttributes(intent.params);
      case 'getCategories':
        return await getCategories(intent.params);
      case 'getYarnBoxes':
        return await getYarnBoxes(intent.params);
      case 'getYarnCones':
        return await getYarnCones(intent.params);
      case 'getStorageSlots':
        return await getStorageSlots(intent.params);
      case 'getArticlesByOrder':
        return await getArticlesByOrder(intent.params);
      case 'getArticleById':
        return await getArticleById(intent.params);
      // New production and order actions
      case 'getProductionOrders':
        return await getProductionOrders(intent.params);
      case 'getProductionDashboard':
        return await getProductionDashboard(intent.params);
      case 'getOrders':
        return await getOrders(intent.params);
      case 'getSalesData':
        return await getSalesData(intent.params, { sessionId });
      default:
        throw new Error(`Unknown action: ${intent.action}`);
    }
  } catch (error) {
    console.error('Error executing AI tool:', error);
    return generateHTMLResponse('Error', `Failed to execute ${intent.action}: ${error.message}`);
  }
};

export default {
  getTopProducts,
  getProductCount,
  getProductsList,
  getStoresList,
  getTopProductsInCity,
  getSalesReport,
  getAnalyticsDashboard,
  getBrandPerformance,
  getStoreAnalysis,
  getProductForecast,
  getCapabilities,
  getProductAnalysis,
  getStoreAnalysisByName,
  // New exports
  getMachineStatistics,
  getMachinesByStatus,
  getMachinesByFloor,
  getYarnCatalog,
  getYarnInventory,
  getLiveInventory,
  getRecentPOStatus,
  getYarnTransactions,
  getYarnIssue,
  getYarnReturn,
  getYarnRequisitions,
  getYarnPurchaseOrders,
  getYarnPurchaseOrderById,
  createYarnPurchaseOrder,
  editYarnPurchaseOrder,
  updateYarnPurchaseOrderStatus,
  deleteYarnPurchaseOrder,
  getYarnTypes,
  getYarnSuppliers,
  getYarnCountSizes,
  getYarnColors,
  getSuppliersByYarnColour,
  getYarnBlends,
  getYarnBoxes,
  getYarnCones,
  getRawMaterials,
  getProcesses,
  getProductAttributes,
  getCategories,
  getStorageSlots,
  getArticlesByOrder,
  getArticleById,
  getProductionOrders,
  getProductionDashboard,
  getOrders,
  getSalesData,
  detectIntent,
  executeAITool
};
