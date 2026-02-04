#!/usr/bin/env node
/**
 * Test script: Create + start an Agent UI flow for PO creation.
 * Prereqs: Backend running (default http://localhost:3003), valid JWT.
 *
 * Usage:
 *   node scripts/run-agent-po-flow.js
 *   AGENT_API_BASE=http://localhost:3003/v1 AGENT_TOKEN=<jwt> node scripts/run-agent-po-flow.js
 *
 * Then in the CRM frontend (browser console, with AgentPlayer mounted):
 *   window.dispatchEvent(new CustomEvent('AGENT_START', { detail: { jobId: '<printed-jobId>' } }));
 */

const API_BASE = process.env.AGENT_API_BASE || 'http://localhost:3003/v1';
const TOKEN = process.env.AGENT_TOKEN || process.env.GENT_TOKEN || '';

const jobId = `JOB_${Date.now()}`;

const sampleContext = {
  order: {
    purchaseDate: '2026-02-04',
    supplierName: 'WAMPUM SYNTEX PRIVATE LIMITED',
    notes: 'Test run from script',
    items: [
      {
        yarnName: '20/40 Beige',
        size: '20/40',
        shade: 'WN1881',
        rate: 90,
        qty: 100,
        delivery: '2026-02-28',
        gst: 5,
      },
    ],
  },
};

async function run() {
  if (!TOKEN) {
    console.error('Missing AGENT_TOKEN. Get a JWT from CRM (e.g. Cookies.accessToken or localStorage.token) and run:');
    console.error('  AGENT_TOKEN=<your-jwt> node scripts/run-agent-po-flow.js');
    process.exitCode = 1;
    return;
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${TOKEN}`,
  };

  try {
    const createRes = await fetch(`${API_BASE}/agent/ui-flow/job`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jobId,
        flowKey: 'purchase.po.create.ui',
        refType: 'PO',
        refId: null,
        context: sampleContext,
      }),
    });
    if (!createRes.ok) {
      const t = await createRes.text();
      throw new Error(`Create job failed: ${createRes.status} ${t}`);
    }

    const startRes = await fetch(`${API_BASE}/agent/ui-flow/start`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jobId }),
    });
    if (!startRes.ok) {
      const t = await startRes.text();
      throw new Error(`Start flow failed: ${startRes.status} ${t}`);
    }

    console.log('Job created and started.');
    console.log('jobId:', jobId);
    console.log('');
    console.log('Use THIS jobId in the browser (each script run = new job; old jobIds are completed):');
    console.log('');
    console.log(`  window.dispatchEvent(new CustomEvent('AGENT_START', { detail: { jobId: '${jobId}' } }));`);
    console.log('');
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}

run();
