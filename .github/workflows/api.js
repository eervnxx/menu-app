const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// GitHub config - التوكن من GitHub Secrets
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = process.env.GITHUB_REPOSITORY ? process.env.GITHUB_REPOSITORY.split('/')[0] : 'YOUR_USERNAME';
const REPO_NAME = process.env.GITHUB_REPOSITORY ? process.env.GITHUB_REPOSITORY.split('/')[1] : 'YOUR_REPO';
const BRANCH = 'main';
const BASE_PATH = 'data';

console.log(`Repo: ${REPO_OWNER}/${REPO_NAME}`);

// Helper functions
async function getFile(filePath) {
    try {
        const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`;
        const response = await axios.get(url, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
        return JSON.parse(content);
    } catch (error) {
        if (error.response && error.response.status === 404) return null;
        throw error;
    }
}

async function saveFile(filePath, content) {
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`;
    const contentBase64 = Buffer.from(JSON.stringify(content, null, 2)).toString('base64');
    
    let sha = null;
    try {
        const response = await axios.get(url, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        sha = response.data.sha;
    } catch (e) {}

    const body = {
        message: `Update ${filePath}`,
        content: contentBase64,
        branch: BRANCH
    };
    if (sha) body.sha = sha;

    await axios.put(url, body, {
        headers: {
            'Authorization': `token ${GITHUB_TOKEN}`,
            'Content-Type': 'application/json',
            'Accept': 'application/vnd.github.v3+json'
        }
    });
}

async function deleteFile(filePath) {
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`;
    
    try {
        const response = await axios.get(url, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        await axios.delete(url, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            data: {
                message: `Delete ${filePath}`,
                sha: response.data.sha,
                branch: BRANCH
            }
        });
    } catch (e) {}
}

// API Endpoints
app.get('/api/restaurants', async (req, res) => {
    try {
        const data = await getFile(`${BASE_PATH}/index.json`);
        res.json(data || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/restaurants/:id', async (req, res) => {
    try {
        const data = await getFile(`${BASE_PATH}/restaurant_${req.params.id}.json`);
        if (!data) {
            return res.status(404).json({ error: 'Restaurant not found' });
        }
        res.json(data);
    } catch (error) {
        res.status(404).json({ error: 'Restaurant not found' });
    }
});

app.post('/api/restaurants', async (req, res) => {
    try {
        const body = req.body;
        const restaurants = await getFile(`${BASE_PATH}/index.json`) || [];
        const newId = restaurants.length > 0 ? Math.max(...restaurants.map(r => r.id)) + 1 : 1;
        const newRestaurant = { ...body, id: newId, created_at: new Date().toISOString() };
        
        await saveFile(`${BASE_PATH}/restaurant_${newId}.json`, newRestaurant);
        restaurants.push({ id: newId, name: body.name, is_active: body.is_active !== false });
        await saveFile(`${BASE_PATH}/index.json`, restaurants);
        
        res.json({ success: true, id: newId });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/restaurants/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const body = req.body;
        await saveFile(`${BASE_PATH}/restaurant_${id}.json`, { ...body, id, updated_at: new Date().toISOString() });
        
        const restaurants = await getFile(`${BASE_PATH}/index.json`) || [];
        const idx = restaurants.findIndex(r => r.id === id);
        if (idx !== -1) {
            restaurants[idx] = { id, name: body.name, is_active: body.is_active !== false };
            await saveFile(`${BASE_PATH}/index.json`, restaurants);
        }
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/restaurants/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        await deleteFile(`${BASE_PATH}/restaurant_${id}.json`);
        
        const restaurants = await getFile(`${BASE_PATH}/index.json`) || [];
        const filtered = restaurants.filter(r => r.id !== id);
        await saveFile(`${BASE_PATH}/index.json`, filtered);
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/upload', async (req, res) => {
    try {
        // قراءة الملف من FormData
        const formData = new FormData();
        // في GitHub Actions، نستخدم multer أو نستقبل الملف مباشرة
        // لكن بما أننا في بيئة محدودة، سنستخدم base64
        
        const { image } = req.body;
        if (!image) {
            return res.status(400).json({ error: 'No image provided' });
        }
        
        // تحويل base64 إلى Blob
        const base64Data = image.split(',')[1] || image;
        const buffer = Buffer.from(base64Data, 'base64');
        
        // إرسال إلى ImgBB
        const imgbbFormData = new FormData();
        const blob = new Blob([buffer], { type: 'image/jpeg' });
        imgbbFormData.append('image', blob, 'image.jpg');
        
        const response = await axios.post('https://api.imgbb.com/1/upload?key=da3f49b21529668b440b1a7ac820fecf', imgbbFormData, {
            headers: {
                'Content-Type': 'multipart/form-data'
            }
        });
        
        if (response.data.success) {
            res.json({ url: response.data.data.url });
        } else {
            res.status(500).json({ error: 'Upload failed' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// بدء السيرفر
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 API Server running on port ${PORT}`);
    console.log(`📁 Repo: ${REPO_OWNER}/${REPO_NAME}`);
});
