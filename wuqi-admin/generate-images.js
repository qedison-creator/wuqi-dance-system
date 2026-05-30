const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const images = [
    {
        name: '晨安',
        filename: 'hero-sunrise.jpg',
        prompt: '清晨日出，温暖阳光，柔和光晕，温馨自然风格，高质量，16:9'
    },
    {
        name: '上午好',
        filename: 'hero-morning.jpg',
        prompt: '晴朗蓝天，白云，明亮阳光，温馨自然风格，高质量，16:9'
    },
    {
        name: '午安',
        filename: 'hero-noon.jpg',
        prompt: '温暖午后阳光，咖啡休憩，温馨惬意，高质量，16:9'
    },
    {
        name: '下午好',
        filename: 'hero-afternoon.jpg',
        prompt: '活力舞蹈室，明亮温暖，下午阳光，温馨自然风格，高质量，16:9'
    },
    {
        name: '傍晚好',
        filename: 'hero-sunset.jpg',
        prompt: '日落黄昏，暖色调光晕，温馨自然风格，高质量，16:9'
    },
    {
        name: '晚上好',
        filename: 'hero-night.jpg',
        prompt: '月亮在星空下，宁静夜晚，温馨自然风格，高质量，16:9'
    },
    {
        name: '夜深了',
        filename: 'hero-late-night.jpg',
        prompt: '深夜城市，宁静夜晚，温馨自然风格，高质量，16:9'
    }
];

const baseUrl = 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image';
const imageSize = 'landscape_16_9';
const targetDir = path.join(__dirname, 'images', 'hero');

function downloadWithRedirect(url, options = {}) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        
        client.get(url, options, (response) => {
            if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307 || response.statusCode === 308) {
                const newUrl = response.headers.location;
                console.log(`重定向到: ${newUrl}`);
                return resolve(downloadWithRedirect(newUrl, options));
            }
            
            if (response.statusCode !== 200) {
                reject(new Error(`请求失败，状态码: ${response.statusCode}`));
                return;
            }
            
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => resolve(Buffer.concat(chunks)));
        }).on('error', reject);
    });
}

async function downloadImage(imageInfo) {
    const url = `${baseUrl}?prompt=${encodeURIComponent(imageInfo.prompt)}&image_size=${imageSize}`;
    const filePath = path.join(targetDir, imageInfo.filename);
    
    console.log(`正在生成: ${imageInfo.name}`);
    
    try {
        const buffer = await downloadWithRedirect(url);
        fs.writeFileSync(filePath, buffer);
        console.log(`✓ 已保存: ${imageInfo.filename}`);
    } catch (error) {
        console.error(`✗ 生成失败: ${imageInfo.name}`, error.message);
        throw error;
    }
}

async function main() {
    console.log('开始生成7张问候图片...\n');
    
    for (const image of images) {
        try {
            await downloadImage(image);
            await new Promise(resolve => setTimeout(resolve, 3000));
        } catch (error) {
            console.error(`✗ 生成失败: ${image.name}`, error.message);
        }
    }
    
    console.log('\n所有图片生成完成！');
}

main().catch(console.error);
