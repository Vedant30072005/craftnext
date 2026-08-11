// Quick test: can we send an email with the configured credentials?
require("dotenv").config({ path: require("path").join(__dirname, ".env") });

const nodemailer = require("nodemailer");

console.log("EMAIL_USER:", process.env.EMAIL_USER || "(not set)");
console.log("EMAIL_PASS:", process.env.EMAIL_PASS ? "(set, " + process.env.EMAIL_PASS.length + " chars)" : "(not set)");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 10000,
});

transporter.verify()
  .then(() => {
    console.log("✅ Gmail SMTP connection successful! Credentials are valid.");
    return transporter.sendMail({
      from: `"CraftNext Test" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_USER, // send to yourself
      subject: "CraftNext OTP Test",
      text: "If you received this, email sending works!",
    });
  })
  .then(() => {
    console.log("✅ Test email sent successfully!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Email test failed:", err.message);
    process.exit(1);
  });
