import httpStatus from 'http-status';
import mongoose from 'mongoose';
import { YarnPurchaseOrder, YarnBox } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';
import { yarnPurchaseOrderStatuses, lotStatuses } from '../../models/yarnReq/yarnPurchaseOrder.model.js';
import * as supplierService from './supplier.service.js';

export const getPurchaseOrders = async ({ startDate, endDate, statusCode }) => {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  const filter = {
    createDate: {
      $gte: start,
      $lte: end,
    },
  };

  if (statusCode) {
    filter.currentStatus = statusCode;
  }

  const purchaseOrders = await YarnPurchaseOrder.find(filter)
    .populate({
      path: 'supplier',
      select: '_id brandName contactPersonName contactNumber email',
    })
    .populate({
      path: 'poItems.yarn',
      select: '_id yarnName yarnType status',
    })
    .sort({ createDate: -1 })
    .lean();

  return purchaseOrders;
};

export const getPurchaseOrderById = async (purchaseOrderId) => {
  const purchaseOrder = await YarnPurchaseOrder.findById(purchaseOrderId)
    .populate({
      path: 'supplier',
      select: '_id brandName contactPersonName contactNumber email address city state',
    })
    .populate({
      path: 'poItems.yarn',
      select: '_id yarnName yarnType status',
    });

  return purchaseOrder;
};

/**
 * Get purchase order by PO number (for agent/FAQ lookup)
 * @param {string} poNumber - PO number
 * @returns {Promise<Object|null>}
 */
export const getPurchaseOrderByPoNumber = async (poNumber) => {
  if (!poNumber || typeof poNumber !== 'string' || !poNumber.trim()) {
    return null;
  }
  const order = await YarnPurchaseOrder.findOne({ poNumber: poNumber.trim() })
    .populate({
      path: 'supplier',
      select: '_id brandName contactPersonName contactNumber email address city state',
    })
    .populate({
      path: 'poItems.yarn',
      select: '_id yarnName yarnType status',
    })
    .lean();
  return order;
};

/**
 * Get only the status of a purchase order by PO number (lightweight lookup).
 * @param {string} poNumber - PO number (e.g. PO-2025-001)
 * @returns {Promise<{ poNumber: string, currentStatus: string }|null>}
 */
export const getPurchaseOrderStatusByPoNumber = async (poNumber) => {
  if (!poNumber || typeof poNumber !== 'string' || !poNumber.trim()) {
    return null;
  }
  const order = await YarnPurchaseOrder.findOne(
    { poNumber: poNumber.trim() },
    { poNumber: 1, currentStatus: 1, _id: 0 }
  )
    .lean();
  if (!order) return null;
  return {
    poNumber: order.poNumber,
    currentStatus: order.currentStatus || null,
  };
};

/**
 * Get counts of purchase orders by currentStatus (for "how many received / in transit").
 * @param {Object} [dateRange] - Optional { startDate, endDate }
 * @returns {Promise<{ total: number, byStatus: Record<string, number>, received: number, inTransit: number }>}
 */
export const getPurchaseOrderCountsByStatus = async (dateRange = {}) => {
  const filter = {};
  if (dateRange.startDate || dateRange.endDate) {
    filter.createDate = {};
    if (dateRange.startDate) filter.createDate.$gte = new Date(dateRange.startDate);
    if (dateRange.endDate) {
      const end = new Date(dateRange.endDate);
      end.setHours(23, 59, 59, 999);
      filter.createDate.$lte = end;
    }
  }
  const rows = await YarnPurchaseOrder.aggregate([
    { $match: Object.keys(filter).length ? filter : {} },
    { $group: { _id: '$currentStatus', count: { $sum: 1 } } }
  ]).then((arr) => arr || []);
  const byStatus = {};
  let total = 0;
  rows.forEach((r) => {
    const status = r._id || 'unknown';
    byStatus[status] = r.count || 0;
    total += r.count || 0;
  });
  const received = (byStatus.goods_received || 0) + (byStatus.goods_partially_received || 0);
  const inTransit = byStatus.in_transit || 0;
  return { total, byStatus, received, inTransit };
};

/**
 * Suggest next PO number for new orders (e.g. PO-2025-001, PO-2025-002).
 * Finds the highest PO number for the current year and increments it.
 * @returns {Promise<string>} e.g. "PO-2025-001"
 */
export const getNextSuggestedPoNumber = async () => {
  const year = new Date().getFullYear();
  const prefix = `PO-${year}-`;
  const orders = await YarnPurchaseOrder.find({ poNumber: new RegExp(`^${prefix}\\d+$`) })
    .sort({ poNumber: -1 })
    .limit(1)
    .select('poNumber')
    .lean();
  const lastOrder = orders[0];
  if (!lastOrder || !lastOrder.poNumber) {
    return `${prefix}001`;
  }
  const match = lastOrder.poNumber.match(new RegExp(`^${prefix}(\\d+)$`));
  const nextNum = match ? parseInt(match[1], 10) + 1 : 1;
  return `${prefix}${String(nextNum).padStart(3, '0')}`;
};

/**
 * Get supplier tearweight for yarn(s) based on PO number.
 *
 * - If a single yarnName is provided, returns a single-object response:
 *   { poNumber, supplierId, yarnName, tearweight, notFound }
 * - If multiple yarnName values are provided, returns the list-style response:
 *   { poNumber, supplierId, yarnTearweights: [...], notFound: [...] }
 * @param {string} poNumber
 * @param {string|string[]} yarnNames
 * @returns {Promise<Object>}
 */
export const getSupplierTearweightByPoAndYarnName = async (poNumber, yarnNames) => {
  const normalizedPoNumber = poNumber ? String(poNumber).trim() : '';
  if (!normalizedPoNumber) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'poNumber is required');
  }

  const order = await YarnPurchaseOrder.findOne({ poNumber: normalizedPoNumber })
    .select('poNumber supplier')
    .lean();

  if (!order) {
    throw new ApiError(httpStatus.NOT_FOUND, `Purchase order not found for PO number: ${normalizedPoNumber}`);
  }

  const supplierId = order.supplier?.toString?.() || order.supplier;
  if (!supplierId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Supplier not found for this purchase order');
  }

  const requestedNamesRaw = Array.isArray(yarnNames) ? yarnNames : yarnNames ? [yarnNames] : [];
  const requestedNames = requestedNamesRaw.map((n) => String(n).trim()).filter(Boolean);

  const result = await supplierService.getSupplierYarnTearweight(supplierId, requestedNames);

  // If the caller asked for exactly one yarn name, return the single-object shape (as in the shared file)
  if (requestedNames.length === 1) {
    const yarnName = requestedNames[0];
    const match = (result.yarnTearweights || []).find((y) => String(y.yarnName).trim() === yarnName);
    const notFound = (result.notFound || []).includes(yarnName);
    return {
      poNumber: order.poNumber,
      supplierId: result.supplierId,
      yarnName,
      tearweight: match ? match.tearweight : null,
      notFound,
    };
  }

  // Otherwise keep the list-style response
  return {
    poNumber: order.poNumber,
    ...result,
  };
};

export const createPurchaseOrder = async (purchaseOrderBody) => {
  const existing = await YarnPurchaseOrder.findOne({ poNumber: purchaseOrderBody.poNumber });
  if (existing) {
    const suggestedPoNumber = await getNextSuggestedPoNumber();
    throw new ApiError(httpStatus.BAD_REQUEST, 'PO number already exists', true, '', { suggestedPoNumber });
  }

  const currentStatus = purchaseOrderBody.currentStatus || yarnPurchaseOrderStatuses[0];
  let statusLogs = purchaseOrderBody.statusLogs || [];
  if (statusLogs.length === 0) {
    statusLogs = [
      {
        statusCode: currentStatus,
        updatedBy: { username: 'system', user: new mongoose.Types.ObjectId() },
        notes: 'Order created',
      },
    ];
  }

  const payload = {
    ...purchaseOrderBody,
    currentStatus,
    statusLogs,
  };

  const purchaseOrder = await YarnPurchaseOrder.create(payload);
  return purchaseOrder;
};

export const updatePurchaseOrderById = async (purchaseOrderId, updateBody) => {
  const purchaseOrder = await YarnPurchaseOrder.findById(purchaseOrderId);

  if (!purchaseOrder) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Purchase order not found');
  }

  if (updateBody.poNumber && updateBody.poNumber !== purchaseOrder.poNumber) {
    const poExists = await YarnPurchaseOrder.findOne({ poNumber: updateBody.poNumber, _id: { $ne: purchaseOrderId } });
    if (poExists) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'PO number already exists');
    }
  }

  Object.assign(purchaseOrder, updateBody);
  await purchaseOrder.save();
  return purchaseOrder;
};

export const deletePurchaseOrderById = async (purchaseOrderId) => {
  const purchaseOrder = await YarnPurchaseOrder.findById(purchaseOrderId);

  if (!purchaseOrder) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Purchase order not found');
  }

  await purchaseOrder.deleteOne();
  return purchaseOrder;
};

export const updatePurchaseOrderStatus = async (purchaseOrderId, statusCode, updatedBy, notes = null) => {
  const purchaseOrder = await YarnPurchaseOrder.findById(purchaseOrderId);

  if (!purchaseOrder) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Purchase order not found');
  }

  if (!yarnPurchaseOrderStatuses.includes(statusCode)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid status code');
  }

  purchaseOrder.currentStatus = statusCode;
  purchaseOrder.statusLogs.push({
    statusCode,
    updatedBy: {
      username: updatedBy.username,
      user: updatedBy.user_id,
    },
    notes: notes || undefined,
  });

  if (statusCode === 'goods_received' || statusCode === 'goods_partially_received') {
    if (!purchaseOrder.goodsReceivedDate) {
      purchaseOrder.goodsReceivedDate = new Date();
    }
  }

  await purchaseOrder.save();
  return purchaseOrder;
};

export const updateLotStatus = async (poNumber, lotNumber, lotStatus) => {
  const purchaseOrder = await YarnPurchaseOrder.findOne({ poNumber });

  if (!purchaseOrder) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Purchase order not found');
  }

  if (!lotStatuses.includes(lotStatus)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid lot status');
  }

  if (!purchaseOrder.receivedLotDetails || purchaseOrder.receivedLotDetails.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No received lot details found for this purchase order');
  }

  // Find the lot in receivedLotDetails
  const lotIndex = purchaseOrder.receivedLotDetails.findIndex(
    (lot) => lot.lotNumber === lotNumber
  );

  if (lotIndex === -1) {
    throw new ApiError(httpStatus.NOT_FOUND, `Lot ${lotNumber} not found in received lot details`);
  }

  // Update the lot status
  purchaseOrder.receivedLotDetails[lotIndex].status = lotStatus;

  await purchaseOrder.save();
  return purchaseOrder;
};

export const updateLotStatusAndQcApprove = async (poNumber, lotNumber, lotStatus, updatedBy, notes, qcData) => {
  const purchaseOrder = await YarnPurchaseOrder.findOne({ poNumber });

  if (!purchaseOrder) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Purchase order not found');
  }

  if (!lotStatuses.includes(lotStatus)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid lot status');
  }

  if (!purchaseOrder.receivedLotDetails || purchaseOrder.receivedLotDetails.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No received lot details found for this purchase order');
  }

  // Find the lot in receivedLotDetails
  const lotIndex = purchaseOrder.receivedLotDetails.findIndex(
    (lot) => lot.lotNumber === lotNumber
  );

  if (lotIndex === -1) {
    throw new ApiError(httpStatus.NOT_FOUND, `Lot ${lotNumber} not found in received lot details`);
  }

  // Update the lot status
  purchaseOrder.receivedLotDetails[lotIndex].status = lotStatus;

  // Update receivedBy if provided
  if (updatedBy) {
    purchaseOrder.receivedBy = {
      username: updatedBy.username,
      user: updatedBy.user_id,
      receivedAt: new Date(),
    };
  }

  await purchaseOrder.save();

  // Update all boxes for this PO and lot with QC data
  // Only update QC status if lot is accepted or rejected
  let qcStatus = null;
  let actionMessage = '';

  if (lotStatus === 'lot_accepted') {
    qcStatus = 'qc_approved';
    actionMessage = 'QC approved';
  } else if (lotStatus === 'lot_rejected') {
    qcStatus = 'qc_rejected';
    actionMessage = 'QC rejected';
  }

  const boxes = await YarnBox.find({ poNumber, lotNumber });

  if (boxes.length > 0 && qcStatus) {
    // Prepare QC update fields
    const qcUpdateFields = {
      'qcData.status': qcStatus,
      'qcData.date': new Date(),
    };

    if (updatedBy) {
      qcUpdateFields['qcData.user'] = updatedBy.user_id;
      qcUpdateFields['qcData.username'] = updatedBy.username;
    }

    if (qcData.remarks !== undefined) {
      qcUpdateFields['qcData.remarks'] = qcData.remarks;
    }

    if (qcData.mediaUrl && typeof qcData.mediaUrl === 'object') {
      qcUpdateFields['qcData.mediaUrl'] = qcData.mediaUrl;
    }

    // Update all boxes for this lot
    await YarnBox.updateMany(
      { poNumber, lotNumber },
      { $set: qcUpdateFields }
    );
  }

  // Fetch updated boxes
  const updatedBoxes = await YarnBox.find({ poNumber, lotNumber });

  const message = qcStatus
    ? `Successfully updated lot status to ${lotStatus} and ${actionMessage} ${updatedBoxes.length} boxes for lot ${lotNumber}`
    : `Successfully updated lot status to ${lotStatus} for lot ${lotNumber}`;

  return {
    purchaseOrder,
    boxes: updatedBoxes,
    updatedBoxesCount: updatedBoxes.length,
    qcStatus: qcStatus || null,
    message,
  };
};


