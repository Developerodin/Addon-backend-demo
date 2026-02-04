import express from 'express';
import auth from '../../middlewares/auth.js';
import validate from '../../middlewares/validate.js';
import * as agentValidation from '../../validations/agent.validation.js';
import * as agentController from '../../controllers/agent.controller.js';

const router = express.Router();

/** Create a new agent job (pending). Then call start with this jobId. */
router
  .route('/ui-flow/job')
  .post(auth(), validate(agentValidation.createJob), agentController.createJob);

/** Start UI flow: marks job running, returns job + flow. Then open stream. */
router
  .route('/ui-flow/start')
  .post(auth(), validate(agentValidation.jobIdOnly), agentController.startUiFlow);

/** SSE stream of resolved steps. Connect after start. */
router
  .route('/ui-flow/stream')
  .get(auth(), validate(agentValidation.streamQuery), agentController.streamUiFlow);

/** Mark job completed. Call after frontend receives DONE step. */
router
  .route('/ui-flow/complete')
  .post(auth(), validate(agentValidation.jobIdOnly), agentController.completeUiFlow);

export default router;
