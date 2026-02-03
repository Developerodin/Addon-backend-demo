import express from 'express';
import validate from '../../../middlewares/validate.js';
import * as yarnPurchaseOrderValidation from '../../../validations/yarnPurchaseOrder.validation.js';
import * as yarnPurchaseOrderController from '../../../controllers/yarnManagement/yarnPurchaseOrder.controller.js';

const router = express.Router();

router
  .route('/')
  .get(
    validate(yarnPurchaseOrderValidation.getPurchaseOrders),
    yarnPurchaseOrderController.getPurchaseOrders
  )
  .post(
    validate(yarnPurchaseOrderValidation.createPurchaseOrder),
    yarnPurchaseOrderController.createPurchaseOrder
  );

router
  .route('/tearweight')
  .get(
    validate(yarnPurchaseOrderValidation.getSupplierTearweightByPoAndYarnName),
    yarnPurchaseOrderController.getSupplierTearweightByPoAndYarnName
  );

router
  .route('/lot-status')
  .patch(
    validate(yarnPurchaseOrderValidation.updateLotStatus),
    yarnPurchaseOrderController.updateLotStatus
  );

router
  .route('/lot-status-qc-approve')
  .patch(
    validate(yarnPurchaseOrderValidation.updateLotStatusAndQcApprove),
    yarnPurchaseOrderController.updateLotStatusAndQcApprove
  );

// Next suggested PO number (must be before /:purchaseOrderId)
router
  .route('/next-po-number')
  .get(
    validate(yarnPurchaseOrderValidation.getNextSuggestedPoNumber),
    yarnPurchaseOrderController.getNextSuggestedPoNumber
  );

// By PO number (must be before /:purchaseOrderId so "by-po" is not treated as ID)
router
  .route('/by-po/:poNumber')
  .get(
    validate(yarnPurchaseOrderValidation.getPurchaseOrderByPoNumber),
    yarnPurchaseOrderController.getPurchaseOrderByPoNumber
  );

router
  .route('/by-po/:poNumber/status')
  .get(
    validate(yarnPurchaseOrderValidation.getPurchaseOrderStatusByPoNumber),
    yarnPurchaseOrderController.getPurchaseOrderStatusByPoNumber
  );

router
  .route('/:purchaseOrderId')
  .get(
    validate(yarnPurchaseOrderValidation.getPurchaseOrderById),
    yarnPurchaseOrderController.getPurchaseOrder
  )
  .patch(
    validate(yarnPurchaseOrderValidation.updatePurchaseOrder),
    yarnPurchaseOrderController.updatePurchaseOrder
  )
  .delete(
    validate(yarnPurchaseOrderValidation.deletePurchaseOrder),
    yarnPurchaseOrderController.deletePurchaseOrder
  );

router
  .route('/:purchaseOrderId/status')
  .patch(
    validate(yarnPurchaseOrderValidation.updatePurchaseOrderStatus),
    yarnPurchaseOrderController.updatePurchaseOrderStatus
  );

export default router;


