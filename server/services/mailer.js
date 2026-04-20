import nodemailer from 'nodemailer';

function getTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER) return null;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
}

export async function sendResetEmail(to, token, appUrl) {
  const transport = getTransport();
  const link = `${appUrl}/reset-password?token=${token}`;

  if (!transport) {
    // Dev fallback — imprime el link en consola
    console.log(`\n[Mailer] SMTP no configurado. Link de reset:\n${link}\n`);
    return;
  }

  await transport.sendMail({
    from: `"Nexus Brain" <${process.env.SMTP_USER}>`,
    to,
    subject: 'Restablecer contraseña — Nexus Brain',
    html: `
      <div style="background:#070709;color:#f0f0f0;font-family:Inter,sans-serif;padding:40px;border-radius:16px;max-width:480px">
        <h2 style="margin:0 0 16px;font-size:1.4rem">🧠 Nexus Brain</h2>
        <p style="color:#888;margin-bottom:24px">Recibimos una solicitud para restablecer tu contraseña.</p>
        <a href="${link}" style="display:inline-block;background:#cc785c;color:#000;padding:12px 24px;border-radius:10px;font-weight:700;text-decoration:none">
          Restablecer contraseña
        </a>
        <p style="color:#555;font-size:.75rem;margin-top:24px">Este link expira en 1 hora. Si no solicitaste el reset, ignora este email.</p>
      </div>`
  });
}
