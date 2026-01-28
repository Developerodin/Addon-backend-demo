import dotenv from 'dotenv';
import path from 'path';
import Joi from 'joi';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const envVarsSchema = Joi.object()
  .keys({
    NODE_ENV: Joi.string().valid('production', 'development', 'test').required(),
    PORT: Joi.number().default(3000),
    MONGODB_URL: Joi.string().required().description('MongoDB URL'),
    JWT_SECRET: Joi.string().required().description('JWT secret key'),
    JWT_ACCESS_EXPIRATION_MINUTES: Joi.number().default(30).description('minutes after which access tokens expire'),
    JWT_REFRESH_EXPIRATION_DAYS: Joi.number().default(30).description('days after which refresh tokens expire'),
    JWT_RESET_PASSWORD_EXPIRATION_MINUTES: Joi.number()
      .default(10)
      .description('minutes after which reset password token expires'),
    JWT_VERIFY_EMAIL_EXPIRATION_MINUTES: Joi.number()
      .default(10)
      .description('minutes after which verify email token expires'),
    SMTP_HOST: Joi.string().description('server that will send the emails'),
    SMTP_PORT: Joi.number().description('port to connect to the email server'),
    SMTP_USERNAME: Joi.string().description('username for email server'),
    SMTP_PASSWORD: Joi.string().description('password for email server'),
    EMAIL_FROM: Joi.string().description('the from field in the emails sent by the app'),
    AWS_ACCESS_KEY_ID: Joi.string().required().description('AWS access key ID'),
    AWS_SECRET_ACCESS_KEY: Joi.string().required().description('AWS secret access key'),
    AWS_REGION: Joi.string().required().description('AWS region'),
    AWS_BUCKET_NAME: Joi.string().required().description('AWS S3 bucket name'),
    OPENAI_API_KEY: Joi.string().required().description('OpenAI API key'),
    FLASK_BACKEND_URL: Joi.string().default('http://localhost:5000').description('URL for the Flask backend'),
    NGROK_DOMAIN: Joi.string().optional().description('Custom ngrok domain (e.g., addon.ngrok.app)'),
    NGROK_AUTHTOKEN: Joi.string().optional().description('ngrok authtoken'),
    GOOGLE_PLACES_API_KEY: Joi.string().optional().description('Google Places API key'),
    BOLNA_API_KEY: Joi.string().optional().description('Bolna AI API key'),
    BOLNA_API_BASE: Joi.string().optional().default('https://api.bolna.ai').description('Bolna AI API base URL'),
    AGENT_ID_ENGLISH: Joi.string().optional().description('Bolna English agent ID'),
    AGENT_ID_HINDI: Joi.string().optional().description('Bolna Hindi agent ID'),
    CALLER_ID: Joi.string().optional().description('Caller ID phone number'),
    PLIVO_AUTH_ID: Joi.string().optional().description('Plivo Auth ID'),
    PLIVO_AUTH_TOKEN: Joi.string().optional().description('Plivo Auth Token'),
    EXOTEL_API_KEY: Joi.string().optional().description('Exotel API Key'),
    EXOTEL_API_TOKEN: Joi.string().optional().description('Exotel API Token'),
    EXOTEL_SUBDOMAIN: Joi.string().optional().description('Exotel Subdomain (api.exotel.com or api.in.exotel.com)'),
    EXOTEL_ACCOUNT_SID: Joi.string().optional().description('Exotel Account SID'),
  })
  .unknown();

const { value: envVars, error } = envVarsSchema.prefs({ errors: { label: 'key' } }).validate(process.env);

if (error) {
  throw Error(`Config validation error: ${error.message}`);
}

// Note: MongoDB URL deprecation warning
// Node.js may show a deprecation warning about MongoDB URLs if the password contains
// special characters that aren't URL-encoded. To fix this, URL-encode the password
// in your MONGODB_URL environment variable (e.g., use encodeURIComponent()).
// Mongoose handles MongoDB URLs correctly regardless of this warning.
const formatMongoUrl = (url) => {
  // Mongoose uses its own URL parser which handles MongoDB URLs correctly
  // The Node.js URL deprecation warning is informational and won't affect functionality
  return url;
};

const config = {
  env: envVars.NODE_ENV,
  port: envVars.PORT,
  mongoose: {
    url: formatMongoUrl(envVars.MONGODB_URL + (envVars.NODE_ENV === 'test' ? '-test' : '')),
    options: {
      useCreateIndex: true, // Optional: Remove this if using Mongoose v6+
      useNewUrlParser: true,
      useUnifiedTopology: true,
    },
  },
  jwt: {
    secret: envVars.JWT_SECRET,
    accessExpirationMinutes: envVars.JWT_ACCESS_EXPIRATION_MINUTES,
    refreshExpirationDays: envVars.JWT_REFRESH_EXPIRATION_DAYS,
    resetPasswordExpirationMinutes: envVars.JWT_RESET_PASSWORD_EXPIRATION_MINUTES,
    verifyEmailExpirationMinutes: envVars.JWT_VERIFY_EMAIL_EXPIRATION_MINUTES,
  },
  email: {
    smtp: {
      host: envVars.SMTP_HOST,
      port: envVars.SMTP_PORT,
      auth: {
        user: envVars.SMTP_USERNAME,
        pass: envVars.SMTP_PASSWORD,
      },
    },
    from: envVars.EMAIL_FROM,
  },
  aws: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION,
    s3: {
      bucket: process.env.AWS_BUCKET_NAME,
    }
  },
  openai: {
    apiKey: envVars.OPENAI_API_KEY,
  },
  flask: {
    backendUrl: process.env.FLASK_BACKEND_URL || 'http://localhost:5000',
  },
  ngrok: {
    domain: process.env.NGROK_DOMAIN,
    authtoken: process.env.NGROK_AUTHTOKEN,
  },
  googlePlaces: {
    apiKey: process.env.GOOGLE_PLACES_API_KEY,
  },
  bolna: {
    apiKey: process.env.BOLNA_API_KEY,
    apiBase: process.env.BOLNA_API_BASE || 'https://api.bolna.ai',
    agentIdEnglish: process.env.AGENT_ID_ENGLISH,
    agentIdHindi: process.env.AGENT_ID_HINDI,
    callerId: process.env.CALLER_ID,
  },
  plivo: {
    authId: process.env.PLIVO_AUTH_ID,
    authToken: process.env.PLIVO_AUTH_TOKEN,
  },
  exotel: {
    apiKey: process.env.EXOTEL_API_KEY,
    apiToken: process.env.EXOTEL_API_TOKEN,
    subdomain: process.env.EXOTEL_SUBDOMAIN,
    accountSid: process.env.EXOTEL_ACCOUNT_SID,
  },
};

export default config;
