import httpStatus from 'http-status';
import ApiError from '../utils/ApiError.js';
import logger from '../config/logger.js';

// Bolna AI authorized IP addresses
const AUTHORIZED_IPS = [
  '13.200.45.61',
  '65.2.44.157',
  '34.194.233.253',
  '13.204.98.4',
  '43.205.31.43',
  '107.20.118.52'
];

/**
 * Middleware to validate webhook requests from Bolna AI or ngrok
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
export const validateBolnaWebhook = (req, res, next) => {
  // Get client IP
  let clientIp = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
  
  // Check if request is forwarded through ngrok or proxy
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    // Extract original IP from X-Forwarded-For (first IP in chain)
    clientIp = forwardedFor.split(',')[0].trim();
  }
  
  // Check for ngrok forwarding indicators
  const isNgrok = (
    req.headers['x-forwarded-proto'] ||
    req.headers['ngrok-skip-browser-warning']
  );
  
  // Allow localhost for local development
  if (['127.0.0.1', 'localhost', '::1', '::ffff:127.0.0.1'].includes(clientIp)) {
    logger.info(`✅ Localhost webhook request allowed: ${clientIp}`);
    return next();
  }
  
  // Allow if IP is authorized OR if it's ngrok (we trust ngrok)
  if (AUTHORIZED_IPS.includes(clientIp) || isNgrok) {
    if (isNgrok) {
      logger.info(`✅ Ngrok webhook request allowed (original IP: ${clientIp})`);
    } else {
      logger.info(`✅ Authorized IP webhook request: ${clientIp}`);
    }
    return next();
  }
  
  // Reject unauthorized requests
  logger.warning(`❌ Unauthorized webhook request from IP: ${clientIp}`);
  throw new ApiError(httpStatus.FORBIDDEN, 'Unauthorized webhook request');
};
