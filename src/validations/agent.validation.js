import Joi from 'joi';

const jobIdOnly = {
  body: Joi.object().keys({
    jobId: Joi.string().required().trim(),
  }),
};

const streamQuery = {
  query: Joi.object().keys({
    jobId: Joi.string().required().trim(),
  }),
};

const createJob = {
  body: Joi.object().keys({
    jobId: Joi.string().required().trim(),
    flowKey: Joi.string().required().trim(),
    refType: Joi.string().allow('', null).trim(),
    refId: Joi.string().allow('', null).trim(),
    context: Joi.object().unknown(true),
  }),
};

export { jobIdOnly, streamQuery, createJob };
