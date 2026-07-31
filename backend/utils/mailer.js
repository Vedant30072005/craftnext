const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS, // Gmail App Password (not account password)
  },
});

async function sendOTPEmail(to, otp) {
  await transporter.sendMail({
    from: `"CraftNext" <${process.env.EMAIL_USER}>`,
    to,
    subject: "Your CraftNext OTP",
    html: `
      <div style="font-family:Inter,sans-serif;max-width:480px;margin:auto;padding:32px;background:#fdf8f3;border-radius:16px">
        <h2 style="color:#e86a33;font-family:serif">CraftNext</h2>
        <p>Your one-time password is:</p>
        <div style="font-size:36px;font-weight:700;letter-spacing:8px;color:#333;margin:20px 0">${otp}</div>
        <p style="color:#888;font-size:13px">Valid for 5 minutes. Do not share this OTP with anyone.</p>
      </div>
    `,
  });
}

async function sendResetEmail(to, resetUrl) {
  await transporter.sendMail({
    from: `"CraftNext" <${process.env.EMAIL_USER}>`,
    to,
    subject: "Reset your CraftNext password",
    html: `
      <div style="font-family:Inter,sans-serif;max-width:480px;margin:auto;padding:32px;background:#fdf8f3;border-radius:16px">
        <h2 style="color:#b6532b;font-family:serif">CraftNext</h2>
        <p>We received a request to reset your password. This link is valid for 30 minutes:</p>
        <p style="margin:20px 0"><a href="${resetUrl}" style="background:#1b1810;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none">Reset Password</a></p>
        <p style="color:#888;font-size:13px">If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  });
}

function orderItemsHtml(order) {
  return order.items.map(i =>
    `<tr><td style="padding:6px 0">${i.name} × ${i.qty}</td><td style="padding:6px 0;text-align:right">₹${(i.price * i.qty).toLocaleString("en-IN")}</td></tr>`
  ).join("");
}

async function sendOrderConfirmationEmail(to, order) {
  await transporter.sendMail({
    from: `"CraftNext" <${process.env.EMAIL_USER}>`,
    to,
    subject: `Order confirmed — #${order._id.toString().slice(-6).toUpperCase()}`,
    html: `
      <div style="font-family:Inter,sans-serif;max-width:480px;margin:auto;padding:32px;background:#fdf8f3;border-radius:16px">
        <h2 style="color:#b6532b;font-family:serif">CraftNext</h2>
        <p>Thanks for your order! Here's what you ordered:</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">${orderItemsHtml(order)}</table>
        <p style="font-weight:700">Total: ₹${order.totalAmount.toLocaleString("en-IN")} (${order.paymentMethod})</p>
        <p style="color:#888;font-size:13px">Order #${order._id.toString().slice(-6).toUpperCase()} · We'll email you again when it ships.</p>
      </div>
    `,
  });
}

async function sendOrderStatusEmail(to, order) {
  const labels = {
    confirmed: "Your order has been confirmed",
    shipped: "Your order is on its way",
    delivered: "Your order has been delivered",
    cancelled: "Your order was cancelled",
  };
  await transporter.sendMail({
    from: `"CraftNext" <${process.env.EMAIL_USER}>`,
    to,
    subject: `${labels[order.status] || "Order update"} — #${order._id.toString().slice(-6).toUpperCase()}`,
    html: `
      <div style="font-family:Inter,sans-serif;max-width:480px;margin:auto;padding:32px;background:#fdf8f3;border-radius:16px">
        <h2 style="color:#b6532b;font-family:serif">CraftNext</h2>
        <p>${labels[order.status] || "Your order status has changed"}: <strong style="text-transform:capitalize">${order.status}</strong></p>
        <p style="color:#888;font-size:13px">Order #${order._id.toString().slice(-6).toUpperCase()} · ₹${order.totalAmount.toLocaleString("en-IN")}</p>
      </div>
    `,
  });
}

module.exports = { sendOTPEmail, sendResetEmail, sendOrderConfirmationEmail, sendOrderStatusEmail };
