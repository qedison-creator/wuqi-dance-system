const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

(async () => {
    console.log('开始生成问候图片...\n');
    
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    
    const htmlPath = path.join(__dirname, 'canvas-generator.html');
    await page.goto(`file://${htmlPath.replace(/\\/g, '/')}`);
    
    await page.waitForTimeout(2000);
    
    const images = [
        { name: '晨安', filename: 'hero-sunrise.jpg', type: 'sunrise' },
        { name: '上午好', filename: 'hero-morning.jpg', type: 'morning' },
        { name: '午安', filename: 'hero-noon.jpg', type: 'noon' },
        { name: '下午好', filename: 'hero-afternoon.jpg', type: 'afternoon' },
        { name: '傍晚好', filename: 'hero-sunset.jpg', type: 'sunset' },
        { name: '晚上好', filename: 'hero-night.jpg', type: 'night' },
        { name: '夜深了', filename: 'hero-late-night.jpg', type: 'lateNight' }
    ];
    
    const saveDir = path.join(__dirname, 'images', 'hero');
    if (!fs.existsSync(saveDir)) {
        fs.mkdirSync(saveDir, { recursive: true });
    }
    
    for (const image of images) {
        console.log(`正在生成: ${image.name}`);
        
        const imageData = await page.evaluate((type) => {
            const canvas = document.getElementById(`canvas-${type}`);
            return canvas.toDataURL('image/jpeg', 0.95);
        }, image.type);
        
        const base64Data = imageData.replace(/^data:image\/jpeg;base64,/, '');
        const filePath = path.join(saveDir, image.filename);
        fs.writeFileSync(filePath, base64Data, 'base64');
        
        console.log(`√ 已保存: ${image.filename}`);
    }
    
    await browser.close();
    
    console.log('\n所有图片生成完成！');
    console.log(`保存位置: ${saveDir}`);
})();
