import puppeteer from 'puppeteer';
import path from 'path';

export const generateInvoicePDF = async (payment) => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  const html = `
    <html>
      <head>
        <style>
          body { font-family: sans-serif; padding: 20px; }
          h1 { text-align: center; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          td, th { border: 1px solid #ddd; padding: 8px; }
          th { background-color: #f2f2f2; }
        </style>
      </head>
      <body>
        <h1>FixLab - Device Repair Invoice</h1>
        <p><strong>Payment Number:</strong> ${payment.paymentNumber}</p>
        <p><strong>Payment Date:</strong> ${new Date(payment.paymentDate).toLocaleString()}</p>
        <p><strong>Recorded By:</strong> ${payment.user.username}</p>

        <h2>Device Information</h2>
        <table>
          <tr><th>Serial Number / IMEI</th><td>${payment.serviceCollection.device.serialNumberOrIMEI}</td></tr>
          <tr><th>Device Name</th><td>${payment.serviceCollection.device.deviceName}</td></tr>
          <tr><th>Device Model</th><td>${payment.serviceCollection.device.deviceModel || "N/A"}</td></tr>
          <tr><th>Customer Name</th><td>${payment.serviceCollection.device.customerName}</td></tr>
          <tr><th>Phone</th><td>${payment.serviceCollection.device.phoneNumber}</td></tr>
        </table>

        <h2>Collection Information</h2>
        <table>
          <tr><th>Collection Name</th><td>${payment.serviceCollection.collection.collectionName}</td></tr>
          <tr><th>Description</th><td>${payment.serviceCollection.collection.collectionDescription}</td></tr>
          <tr><th>Price</th><td>${payment.amountPaid} RWF</td></tr>
        </table>
      </body>
    </html>
  `;

  await page.setContent(html, { waitUntil: 'networkidle0' });

  const filePath = path.resolve(`./invoices/invoice_${payment._id}.pdf`);
  await page.pdf({ path: filePath, format: 'A4' });

  await browser.close();
  return filePath;
};
