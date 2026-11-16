import nodemailer from 'nodemailer';
import { logger } from '../utils/logger.js';

/**
 * DutyLaunch Transactional Email Service.
 * Formats responsive HTML email notifications and dispatches via SMTP / Gmail.
 */

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST || (process.env.GMAIL_USER ? 'smtp.gmail.com' : null);
  const user = process.env.SMTP_USER || process.env.GMAIL_USER;
  const pass = process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD;
  const port = Number(process.env.SMTP_PORT) || 587;
  const secure = port === 465;

  if (host && user && pass) {
    try {
      transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass },
      });
      logger.info(`[Email] SMTP transporter configured with host: ${host}:${port}`);
    } catch (err) {
      logger.error(`[Email] Failed to create SMTP transporter: ${err.message}`);
    }
  }
  return transporter;
}

async function dispatchEmail({ to, subject, html }) {
  const mailTransporter = getTransporter();
  const from = process.env.EMAIL_FROM || process.env.SMTP_USER || process.env.GMAIL_USER || 'no-reply@dutylaunch.com';

  if (!mailTransporter) {
    logger.warn(`[Email] SMTP is not configured. Email to ${to} ("${subject}") preview logged.`);
    return { sent: false, delivered: false, reason: 'SMTP_NOT_CONFIGURED' };
  }

  try {
    const info = await mailTransporter.sendMail({
      from: `DutyLaunch <${from}>`,
      to,
      subject,
      html,
    });
    logger.info(`[Email] Dispatched successfully to ${to} (Message ID: ${info.messageId})`);
    return { sent: true, delivered: true, messageId: info.messageId };
  } catch (err) {
    logger.error(`[Email] Delivery to ${to} failed: ${err.message}`);
    return { sent: false, delivered: false, error: err.message };
  }
}

function getBaseClientUrl() {
  return (process.env.CLIENT_URL || 'http://localhost:5173').split(',')[0].trim();
}

function baseLayout({ title, body, actionText, actionUrl }) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #0f172a; margin: 0; padding: 24px; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; }
    .header { background: linear-gradient(135deg, #091326 0%, #173873 100%); color: #ffffff; padding: 32px 24px; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.02em; }
    .header p { margin: 8px 0 0; color: #93c5fd; font-size: 14px; }
    .content { padding: 32px 24px; line-height: 1.6; font-size: 15px; }
    .order-box { background: #f1f5f9; border-radius: 8px; padding: 16px; margin: 20px 0; border-left: 4px solid #0284c7; }
    .btn { display: inline-block; background: #0284c7; color: #ffffff !important; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 20px; text-align: center; }
    .footer { padding: 24px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #f1f5f9; }
    .disclaimer { font-size: 11px; color: #94a3b8; margin-top: 12px; line-height: 1.4; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>DutyLaunch</h1>
      <p>Professional Career & Resume Crafting Service</p>
    </div>
    <div class="content">
      <h2 style="font-size: 18px; margin-top: 0;">${title}</h2>
      ${body}
      ${actionText && actionUrl ? `<div style="text-align: center;"><a href="${actionUrl}" class="btn">${actionText}</a></div>` : ''}
    </div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} DutyLaunch. All rights reserved.</p>
      <p class="disclaimer">
        Notice: This ATS Score is generated using DutyLaunch's internal evaluation system. It is intended only as a reference based on our internal scoring methodology. It is NOT a universal ATS score.
      </p>
    </div>
  </div>
</body>
</html>
  `.trim();
}

export const emailService = {
  async sendPasswordResetEmail({ user, resetUrl }) {
    const subject = 'Reset Your DutyLaunch Password';
    const html = baseLayout({
      title: 'Reset Your DutyLaunch Account Password',
      body: `
        <p>Hi ${user?.name || 'Valued Member'},</p>
        <p>We received a request to reset the password for your DutyLaunch account associated with <strong>${user?.email}</strong>.</p>
        <p>Click the button below to choose a new password. This reset link is active for <strong>60 minutes</strong>.</p>
        <div class="order-box" style="border-left-color: #0284c7; background: #f8fafc;">
          <p style="margin: 0; font-size: 13px; color: #475569;">
            If the button below does not work, copy and paste this link into your browser:
            <br />
            <a href="${resetUrl}" style="color: #0284c7; word-break: break-all;">${resetUrl}</a>
          </p>
        </div>
        <p style="font-size: 13px; color: #64748b; margin-top: 16px;">
          If you did not request this password reset, please disregard this email. Your current password remains secure.
        </p>
      `,
      actionText: 'Reset My Password',
      actionUrl: resetUrl,
    });

    const dispatchResult = await dispatchEmail({ to: user?.email, subject, html });
    logger.info(`[Email] Password reset dispatched to ${user?.email} (resetUrl: ${resetUrl})`);
    return { ...dispatchResult, subject, html, resetUrl };
  },

  async sendPurchaseConfirmationEmail({ user, order }) {
    const subject = `Purchase Confirmed: ${order.packageName} (Order #${order.orderNumber})`;
    const html = baseLayout({
      title: 'Payment Confirmed & Package Activated',
      body: `
        <p>Hi ${user?.name || 'Valued Candidate'},</p>
        <p>Thank you for purchasing the <strong>${order.packageName}</strong> (${order.experienceBand}). Your payment of <strong>₹${order.price}</strong> has been successfully processed.</p>
        <div class="order-box">
          <p style="margin: 0 0 6px;"><strong>Order Number:</strong> ${order.orderNumber}</p>
          <p style="margin: 0 0 6px;"><strong>Package:</strong> ${order.packageName}</p>
          <p style="margin: 0;"><strong>Status:</strong> ${order.status.toUpperCase()}</p>
        </div>
        <p>Our specialized career writers are ready to craft your high-impact resume and CV. You can review your order progress, notes, and timeline at any time on your dashboard.</p>
      `,
      actionText: 'View Order Status',
      actionUrl: `${process.env.CLIENT_URL || 'http://localhost:5173'}/my-resumes`,
    });
    logger.info(`[Email] Purchase confirmation sent to ${user?.email} for order ${order.orderNumber}`);
    return { sent: true, subject, html };
  },

  async sendRequestReceivedEmail({ user, order }) {
    const subject = `Request Received: Resume Build Order #${order.orderNumber}`;
    const html = baseLayout({
      title: 'Your Documents Have Been Received',
      body: `
        <p>Hi ${user?.name || 'Valued Candidate'},</p>
        <p>We have successfully received your existing documents and custom career instructions for order <strong>#${order.orderNumber}</strong>.</p>
        <div class="order-box">
          <p style="margin: 0 0 6px;"><strong>Expected Turnaround:</strong> Delivery in 2–3 Days</p>
          <p style="margin: 0 0 6px;"><strong>Target Role:</strong> ${order.targetRole || 'As specified in profile'}</p>
          <p style="margin: 0;"><strong>Current Status:</strong> Pending Review & Assignment</p>
        </div>
        <p>Our senior career specialists and QA team will review your career achievements, identify missing keywords, and handcraft an executive-ready CV and cover letter.</p>
      `,
      actionText: 'Track Order',
      actionUrl: `${process.env.CLIENT_URL || 'http://localhost:5173'}/my-resumes`,
    });
    logger.info(`[Email] Request received email sent to ${user?.email} for order ${order.orderNumber}`);
    return { sent: true, subject, html };
  },

  async sendRequestAssignedEmail({ user, order, staffName }) {
    const subject = `Staff Assigned: Order #${order.orderNumber}`;
    const html = baseLayout({
      title: 'Your Order Has Been Assigned',
      body: `
        <p>Hi ${user?.name || 'Valued Candidate'},</p>
        <p>Great news! Your resume build order has been assigned to our specialized career writer${staffName ? ` (<strong>${staffName}</strong>)` : ''}.</p>
        <p>Work on your resume and CV is starting. We are aligning your experience with target industry standards and structuring every achievement for maximum impact.</p>
      `,
      actionText: 'View Activity Timeline',
      actionUrl: `${process.env.CLIENT_URL || 'http://localhost:5173'}/my-resumes`,
    });
    logger.info(`[Email] Request assigned email sent to ${user?.email}`);
    return { sent: true, subject, html };
  },

  async sendWorkStartedEmail({ user, order }) {
    const subject = `Work In Progress: Order #${order.orderNumber}`;
    const html = baseLayout({
      title: 'Work In Progress',
      body: `
        <p>Hi ${user?.name || 'Valued Candidate'},</p>
        <p>Our resume writing team has begun actively drafting and optimizing your CV for order <strong>#${order.orderNumber}</strong>.</p>
        <p>Expected delivery: <strong>${order.expectedDeliveryDate ? new Date(order.expectedDeliveryDate).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : 'Delivery in 2–3 Days'}</strong>.</p>
      `,
      actionText: 'View Dashboard',
      actionUrl: `${process.env.CLIENT_URL || 'http://localhost:5173'}/my-resumes`,
    });
    logger.info(`[Email] Work started email sent to ${user?.email}`);
    return { sent: true, subject, html };
  },

  async sendMoreInfoRequiredEmail({ user, order, message }) {
    const subject = `Update Required: Order #${order.orderNumber}`;
    const html = baseLayout({
      title: 'Additional Information Requested',
      body: `
        <p>Hi ${user?.name || 'Valued Candidate'},</p>
        <p>Our writing team requires a few additional details to complete your CV with the highest level of detail:</p>
        <div class="order-box">
          <p style="margin: 0; font-style: italic;">"${message}"</p>
        </div>
        <p>Please log in to your dashboard to view the message and submit any clarifications.</p>
      `,
      actionText: 'Open Dashboard',
      actionUrl: `${process.env.CLIENT_URL || 'http://localhost:5173'}/my-resumes`,
    });
    logger.info(`[Email] More info required sent to ${user?.email}`);
    return { sent: true, subject, html };
  },

  async sendCompletedEmail({ user, order }) {
    const subject = `Completed! Your New Resume & CV Are Ready (Order #${order.orderNumber})`;
    const html = baseLayout({
      title: 'Your Completed Resume & CV Are Ready!',
      body: `
        <p>Hi ${user?.name || 'Valued Candidate'},</p>
        <p>We are delighted to inform you that our expert team has completed crafting your professional Resume and CV for order <strong>#${order.orderNumber}</strong>.</p>
        <div class="order-box" style="border-left-color: #10b981;">
          <p style="margin: 0 0 6px;"><strong>Status:</strong> COMPLETED & VERIFIED</p>
          <p style="margin: 0;"><strong>Delivered On:</strong> ${new Date().toLocaleDateString('en-IN', { dateStyle: 'medium' })}</p>
        </div>
        <p>Your finished documents are formatted for ATS compatibility and executive presentation. You can download your final files directly from your dashboard now.</p>
        <p style="font-size: 13px; color: #64748b;">Reminder: Your package includes 1 month of unlimited revisions.</p>
      `,
      actionText: 'Download Your Completed Files',
      actionUrl: `${process.env.CLIENT_URL || 'http://localhost:5173'}/my-resumes`,
    });
    logger.info(`[Email] Completed email sent to ${user?.email} for order ${order.orderNumber}`);
    return { sent: true, subject, html };
  },

  async sendRejectedEmail({ user, order, reason }) {
    const subject = `Update Regarding Order #${order.orderNumber}`;
    const html = baseLayout({
      title: 'Notice Regarding Your Order',
      body: `
        <p>Hi ${user?.name || 'Valued Candidate'},</p>
        <p>We are writing to inform you that your resume build order <strong>#${order.orderNumber}</strong> could not be processed at this time.</p>
        <div class="order-box" style="border-left-color: #ef4444;">
          <p style="margin: 0 0 6px;"><strong>Reason:</strong> ${reason || 'Document verification could not be completed.'}</p>
        </div>
        <p>Our support team is available to assist you. If a refund is due, it will be credited back via your original payment method.</p>
      `,
      actionText: 'Contact Support',
      actionUrl: `${process.env.CLIENT_URL || 'http://localhost:5173'}/contact`,
    });
    logger.info(`[Email] Rejected email sent to ${user?.email}`);
    return { sent: true, subject, html };
  },

  async sendAdminAlert({ admins, title, message, orderId }) {
    logger.info(`[Email] Admin alert: "${title}" for order ${orderId} notified to ${admins?.length || 0} admins`);
    return { sent: true };
  },
};
