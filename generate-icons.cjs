const sharp = require('sharp');
const path = require('path');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="64" fill="#3b82f6"/>
  <text x="256" y="340" font-family="Arial, sans-serif" font-size="280" font-weight="bold" fill="white" text-anchor="middle">₾</text>
</svg>`;

async function generateIcons() {
  const publicDir = path.join(__dirname, 'public');

  // Generate 192x192
  await sharp(Buffer.from(svg))
    .resize(192, 192)
    .png()
    .toFile(path.join(publicDir, 'pwa-192x192.png'));

  // Generate 512x512
  await sharp(Buffer.from(svg))
    .resize(512, 512)
    .png()
    .toFile(path.join(publicDir, 'pwa-512x512.png'));

  console.log('Icons generated successfully!');
}

generateIcons().catch(console.error);
