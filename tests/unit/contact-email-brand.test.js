import test from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';

process.env.NODE_ENV = 'test';
process.env.CONTACT_TO = 'pf-inbox@example.com';
const { sendContactEmail } = await import('../../src/app/services/contact-service.js');

test('contact delivery selects the site inbox without changing the SMTP sender', async t => {
  const delivered = [];
  t.mock.method(nodemailer, 'createTransport', () => ({ sendMail: async message => delivered.push(message) }));
    const data = { name: 'Test', business: 'Example', contact: 'test@example.com', message: 'An isolated test.' };
    await sendContactEmail(data, { host: 'pertenecegt.com' });
    await sendContactEmail(data, { host: 'puntosfieles.com' });
    assert.equal(delivered[0].to, 'hola@pertenecegt.com');
    assert.match(delivered[0].html, />Pertenece</);
    assert.match(delivered[0].html, /pertenecegt\.com/);
    assert.equal(delivered[1].to, 'pf-inbox@example.com');
    assert.match(delivered[1].html, />PuntosFieles</);
    assert.equal(delivered[0].from, delivered[1].from);
});
