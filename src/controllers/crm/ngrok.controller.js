import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import * as ngrokService from '../../services/crm/ngrokService.js';
import config from '../../config/config.js';
import fetch from 'node-fetch';

export const getNgrokUrl = catchAsync(async (req, res) => {
  const ngrokUrl = await ngrokService.getNgrokUrl();
  
  if (ngrokUrl) {
    res.send({
      success: true,
      ngrok_url: ngrokUrl,
      message: 'ngrok tunnel is active',
    });
  } else {
    res.status(httpStatus.NOT_FOUND).send({
      success: false,
      error: 'ngrok tunnel not running',
      instructions: [
        '1. Install ngrok: https://ngrok.com/download',
        '2. Start ngrok: ngrok http 5000',
        '3. Make sure ngrok is running on port 4040',
      ],
    });
  }
});

export const getWebhookUrl = catchAsync(async (req, res) => {
  const webhookUrl = await ngrokService.getWebhookUrl();
  const ngrokUrl = await ngrokService.getNgrokUrl();
  
  if (webhookUrl) {
    res.send({
      success: true,
      webhook_url: webhookUrl,
      ngrok_url: ngrokUrl,
      domain_type: config.ngrok?.domain ? 'custom' : 'dynamic',
      supports_multiple_agents: true,
      note: 'This webhook URL supports multiple agents (English & Hindi). Both agents can use the same URL.',
      instructions: {
        step1: 'Copy the webhook_url above',
        step2: 'Go to https://platform.bolna.ai/',
        step3: 'Navigate to Agent Settings → Webhook for BOTH agents',
        step4: 'Paste the SAME webhook_url for both English and Hindi agents',
        step5: 'Save configuration for both agents',
      },
    });
  } else {
    const errorMsg = 'ngrok tunnel not running';
    let instructions = [
      '1. Set NGROK_DOMAIN in .env file (e.g., NGROK_DOMAIN=addon.ngrok.app)',
      '2. OR start ngrok: ngrok http 5000',
      '3. Wait for ngrok to start',
      '4. Try this endpoint again',
    ];
    
    if (config.ngrok?.domain) {
      instructions = [
        `1. Verify NGROK_DOMAIN=${config.ngrok.domain} is correct in .env`,
        '2. Make sure ngrok tunnel is running with this domain',
        '3. Restart Express server after updating .env',
      ];
    }
    
    res.status(httpStatus.NOT_FOUND).send({
      success: false,
      error: errorMsg,
      configured_domain: config.ngrok?.domain || null,
      instructions,
    });
  }
});

export const getNgrokStatus = catchAsync(async (req, res) => {
  try {
    // Get ngrok API info
    try {
      const response = await fetch('http://localhost:4040/api/tunnels', {
        timeout: 2000,
      });
      
      if (response.ok) {
        const data = await response.json();
        const tunnels = data.tunnels || [];
        
        if (tunnels.length > 0) {
          const tunnelInfo = tunnels.map(tunnel => ({
            name: tunnel.name,
            proto: tunnel.proto,
            public_url: tunnel.public_url,
            config: tunnel.config?.addr,
            status: 'active',
          }));
          
          const webhookUrl = await ngrokService.getWebhookUrl();
          const ngrokUrl = await ngrokService.getNgrokUrl();
          
          res.send({
            success: true,
            status: 'active',
            tunnels: tunnelInfo,
            webhook_url: webhookUrl,
            api_url: ngrokUrl,
            custom_domain: config.ngrok?.domain || null,
            domain_type: config.ngrok?.domain ? 'custom' : 'dynamic',
          });
        } else {
          res.status(httpStatus.NOT_FOUND).send({
            success: false,
            status: 'no_tunnels',
            error: 'No tunnels found',
          });
        }
      } else {
        res.status(httpStatus.INTERNAL_SERVER_ERROR).send({
          success: false,
          status: 'ngrok_api_error',
          error: `ngrok API returned status ${response.status}`,
        });
      }
    } catch (error) {
      // If custom domain is configured, it might still work
      if (config.ngrok?.domain) {
        const webhookUrl = await ngrokService.getWebhookUrl();
        res.send({
          success: true,
          status: 'custom_domain',
          webhook_url: webhookUrl,
          custom_domain: config.ngrok.domain,
          message: `Using custom domain: ${config.ngrok.domain}`,
          note: 'ngrok API not accessible, but custom domain is configured',
        });
      } else {
        res.status(httpStatus.NOT_FOUND).send({
          success: false,
          status: 'ngrok_not_running',
          error: 'ngrok is not running or not accessible on port 4040',
          instructions: [
            '1. Set NGROK_DOMAIN=addon.ngrok.app in .env file (for custom domain)',
            '2. OR start ngrok: ngrok http 5000',
            '3. Make sure ngrok web interface is accessible at http://localhost:4040',
          ],
        });
      }
    }
  } catch (error) {
    res.status(httpStatus.INTERNAL_SERVER_ERROR).send({
      success: false,
      status: 'error',
      error: error.message,
    });
  }
});

export const testWebhook = catchAsync(async (req, res) => {
  const payload = req.body || {};
  
  console.log('Test webhook received:', payload);
  
  const webhookUrl = await ngrokService.getWebhookUrl();
  
  res.send({
    success: true,
    message: 'Webhook test successful',
    received_data: payload,
    webhook_url: webhookUrl,
  });
});
