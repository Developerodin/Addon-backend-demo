import fetch from 'node-fetch';
import config from '../../config/config.js';

/**
 * Get the public HTTPS URL from ngrok API or use custom domain
 * @returns {Promise<string|null>}
 */
export const getNgrokUrl = async () => {
  // Check for custom ngrok domain in config
  const customDomain = config.ngrok?.domain;
  
  if (customDomain) {
    // Use custom domain (e.g., addon.ngrok.app)
    // Ensure it starts with https://
    if (!customDomain.startsWith('http')) {
      return `https://${customDomain}`;
    }
    return customDomain;
  }
  
  // Fallback to ngrok API discovery
  try {
    const response = await fetch('http://localhost:4040/api/tunnels', {
      timeout: 2000,
    });
    
    if (response.ok) {
      const data = await response.json();
      const tunnels = data.tunnels || [];
      
      if (tunnels.length > 0) {
        // Prefer HTTPS tunnel
        const httpsTunnel = tunnels.find(tunnel => tunnel.proto === 'https');
        if (httpsTunnel) {
          return httpsTunnel.public_url;
        }
        // Fallback to first tunnel
        return tunnels[0].public_url;
      }
    }
  } catch (error) {
    // ngrok API not accessible, return null
    console.debug(`Could not get ngrok URL from API: ${error.message}`);
  }
  
  return null;
};

/**
 * Get the full webhook URL for Bolna configuration
 * @returns {Promise<string|null>}
 */
export const getWebhookUrl = async () => {
  const ngrokUrl = await getNgrokUrl();
  if (ngrokUrl) {
    // Remove trailing slash if present
    const cleanUrl = ngrokUrl.replace(/\/$/, '');
    // Note: Flask backend uses /api/webhook, but Express uses /v1/crm/webhook
    // We'll use Express endpoint
    return `${cleanUrl}/v1/crm/webhook`;
  }
  return null;
};
