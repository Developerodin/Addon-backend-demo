import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import pick from '../../utils/pick.js';
import * as yarnPurchaseOrderService from '../../services/yarnManagement/yarnPurchaseOrder.service.js';

export const getPurchaseOrders = catchAsync(async (req, res) => {
  const query = pick(req.query, ['start_date', 'end_date', 'status_code']);

  const purchaseOrders = await yarnPurchaseOrderService.getPurchaseOrders({
    startDate: query.start_date,
    endDate: query.end_date,
    statusCode: query.status_code,
  });

  res.status(httpStatus.OK).send(purchaseOrders);
});

export const createPurchaseOrder = catchAsync(async (req, res) => {
  const purchaseOrder = await yarnPurchaseOrderService.createPurchaseOrder(req.body);
  res.status(httpStatus.CREATED).send(purchaseOrder);
});

export const getPurchaseOrder = catchAsync(async (req, res) => {
  const { purchaseOrderId } = req.params;
  const purchaseOrder = await yarnPurchaseOrderService.getPurchaseOrderById(purchaseOrderId);

  if (!purchaseOrder) {
    return res.status(httpStatus.NOT_FOUND).send({ message: 'Purchase order not found' });
  }

  res.status(httpStatus.OK).send(purchaseOrder);
});

/**
 * Fetch full order data by PO number (e.g. PO-2025-001).
 */
export const getPurchaseOrderByPoNumber = catchAsync(async (req, res) => {
  const { poNumber } = req.params;
  const order = await yarnPurchaseOrderService.getPurchaseOrderByPoNumber(poNumber);

  if (!order) {
    return res.status(httpStatus.NOT_FOUND).send({ message: `Purchase order not found for PO number: ${poNumber}` });
  }

  res.status(httpStatus.OK).send(order);
});

/**
 * Get only the status of an order by PO number (lightweight).
 */
export const getPurchaseOrderStatusByPoNumber = catchAsync(async (req, res) => {
  const { poNumber } = req.params;
  const result = await yarnPurchaseOrderService.getPurchaseOrderStatusByPoNumber(poNumber);

  if (!result) {
    return res.status(httpStatus.NOT_FOUND).send({ message: `Purchase order not found for PO number: ${poNumber}` });
  }

  res.status(httpStatus.OK).send(result);
});

/**
 * Get next suggested PO number (e.g. PO-2025-001, PO-2025-002).
 */
export const getNextSuggestedPoNumber = catchAsync(async (req, res) => {
  const suggestedPoNumber = await yarnPurchaseOrderService.getNextSuggestedPoNumber();
  res.status(httpStatus.OK).send({ suggestedPoNumber });
});

/**
 * Get supplier tearweight for given yarn name(s) using a PO number.
 * Query: poNumber, yarnName (single string or repeated: yarnName=a&yarnName=b)
 */
export const getSupplierTearweightByPoAndYarnName = catchAsync(async (req, res) => {
  const { poNumber } = req.query;
  const yarnNameParam = req.query.yarnName;
  const yarnNames = Array.isArray(yarnNameParam) ? yarnNameParam : yarnNameParam ? [yarnNameParam] : [];

  const result = await yarnPurchaseOrderService.getSupplierTearweightByPoAndYarnName(poNumber, yarnNames);
  res.status(httpStatus.OK).send(result);
});

export const deletePurchaseOrder = catchAsync(async (req, res) => {
  const { purchaseOrderId } = req.params;
  await yarnPurchaseOrderService.deletePurchaseOrderById(purchaseOrderId);
  res.status(httpStatus.NO_CONTENT).send();
});

export const updatePurchaseOrder = catchAsync(async (req, res) => {
  const { purchaseOrderId } = req.params;
  const purchaseOrder = await yarnPurchaseOrderService.updatePurchaseOrderById(purchaseOrderId, req.body);
  res.status(httpStatus.OK).send(purchaseOrder);
});

export const updatePurchaseOrderStatus = catchAsync(async (req, res) => {
  const { purchaseOrderId } = req.params;
  const { status_code: statusCode, updated_by: updatedBy, notes } = req.body;

  const purchaseOrder = await yarnPurchaseOrderService.updatePurchaseOrderStatus(
    purchaseOrderId,
    statusCode,
    updatedBy,
    notes
  );

  res.status(httpStatus.OK).send(purchaseOrder);
});

export const updateLotStatus = catchAsync(async (req, res) => {
  const { poNumber, lotNumber, lotStatus } = req.body;

  const purchaseOrder = await yarnPurchaseOrderService.updateLotStatus(
    poNumber,
    lotNumber,
    lotStatus
  );

  res.status(httpStatus.OK).send(purchaseOrder);
});

export const updateLotStatusAndQcApprove = catchAsync(async (req, res) => {
  const { poNumber, lotNumber, lotStatus, updated_by: updatedBy, notes, remarks, mediaUrl } = req.body;

  const qcData = {
    remarks,
    mediaUrl,
  };

  const result = await yarnPurchaseOrderService.updateLotStatusAndQcApprove(
    poNumber,
    lotNumber,
    lotStatus,
    updatedBy,
    notes,
    qcData
  );

  res.status(httpStatus.OK).send(result);
});


