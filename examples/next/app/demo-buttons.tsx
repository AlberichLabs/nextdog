'use client';

// A small client component that fires browser-side activity: a fetch (whose
// server side is traced) and browser `console.*` calls. With the capture script
// in the root layout, these browser logs show up in the NextDog Logs view,
// correlated to the server trace that rendered this page.
import { useState } from 'react';

export function DemoButtons() {
  const [result, setResult] = useState<string>('');

  async function createTask() {
    console.log('[browser] creating a task from the client');
    const response = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: `Task from the browser @ ${new Date().toLocaleTimeString()}` }),
    });
    const data = (await response.json()) as { task?: { id: number } };
    console.log('[browser] created', data);
    setResult(`Created task #${data.task?.id}`);
  }

  function logStuff() {
    console.log('[browser] a normal log');
    console.warn('[browser] a warning');
    console.error('[browser] an error', new Error('demo browser error'));
    setResult('Sent console.log / warn / error to NextDog');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 360 }}>
      <button type="button" onClick={createTask} style={buttonStyle}>
        POST /api/tasks (from the browser)
      </button>
      <button type="button" onClick={logStuff} style={buttonStyle}>
        Emit browser console logs
      </button>
      {result && <p style={{ color: '#2dd4bf', margin: 0 }}>{result}</p>}
    </div>
  );
}

const buttonStyle = {
  padding: '10px 14px',
  borderRadius: 8,
  border: '1px solid #334155',
  background: '#1e293b',
  color: '#e2e8f0',
  cursor: 'pointer',
  fontSize: 14,
  textAlign: 'left' as const,
};
