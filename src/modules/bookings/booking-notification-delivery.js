import nodemailer from 'nodemailer';

export function createBookingNotificationDelivery(config) {
  if (!config.smtpConfigured) {
    return {
      isConfigured: false,
      async sendRequestReceived() {},
      async sendStatusChanged() {},
    };
  }

  const transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD },
  });

  return {
    isConfigured: true,
    async sendRequestReceived({ email, reference, lookupToken }) {
      await transporter.sendMail({
        from: config.SMTP_FROM,
        to: email,
        subject: `AJ Car Rentals booking request ${reference}`,
        text: [
          `We received your booking request ${reference}. It is pending staff review and is not yet confirmed.`,
          '',
          'Keep this private lookup token to view your request:',
          lookupToken,
          '',
          'AJ Car Rentals',
        ].join('\n'),
      });
    },
    async sendStatusChanged({ email, reference, status }) {
      await transporter.sendMail({
        from: config.SMTP_FROM,
        to: email,
        subject: `Booking ${reference} status update`,
        text: `Your AJ Car Rentals booking ${reference} status is now ${status}.`,
      });
    },
  };
}
