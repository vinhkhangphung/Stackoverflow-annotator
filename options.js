// Save and load settings from Chrome storage

const API_KEY_STORAGE_KEY = 'stackoverflow_api_key';
const MIN_UPVOTES_KEY = 'stackoverflow_min_upvotes';
const CACHE_EXPIRY_KEY = 'stackoverflow_cache_expiry_days';
const RATE_LIMIT_KEY = 'stackoverflow_rate_limit_delay';

const MASKED_PLACEHOLDER = '••••••••••••••••';
let actualApiKey = '';
let isModified = false;

// Load saved settings when options page opens
document.addEventListener('DOMContentLoaded', async () => {
    const apiKeyInput = document.getElementById('apiKey');
    const minUpvotesInput = document.getElementById('minUpvotes');
    const cacheExpiryInput = document.getElementById('cacheExpiryDays');
    const rateLimitInput = document.getElementById('rateLimitDelay');
    
    const result = await chrome.storage.sync.get([
        API_KEY_STORAGE_KEY,
        MIN_UPVOTES_KEY,
        CACHE_EXPIRY_KEY,
        RATE_LIMIT_KEY
    ]);
    
    // Load API key
    if (result[API_KEY_STORAGE_KEY]) {
        actualApiKey = result[API_KEY_STORAGE_KEY];
        apiKeyInput.value = MASKED_PLACEHOLDER;
        apiKeyInput.type = 'password';
    }
    
    // Load other settings with defaults
    minUpvotesInput.value = result[MIN_UPVOTES_KEY] || 50;
    cacheExpiryInput.value = result[CACHE_EXPIRY_KEY] || 7;
    rateLimitInput.value = result[RATE_LIMIT_KEY] || 150;
    
    // When user clicks on the input, clear it for editing
    apiKeyInput.addEventListener('focus', () => {
        if (apiKeyInput.value === MASKED_PLACEHOLDER) {
            apiKeyInput.value = '';
            apiKeyInput.type = 'text';
            isModified = false;
        }
    });
    
    // Track if user actually types something
    apiKeyInput.addEventListener('input', () => {
        isModified = true;
    });
    
    // If user leaves without typing, restore masked value
    apiKeyInput.addEventListener('blur', () => {
        if (!isModified && actualApiKey && apiKeyInput.value === '') {
            apiKeyInput.value = MASKED_PLACEHOLDER;
            apiKeyInput.type = 'password';
        }
    });
});

// Save all settings when user clicks Save button
document.getElementById('save').addEventListener('click', async () => {
    const apiKeyInput = document.getElementById('apiKey');
    const minUpvotesInput = document.getElementById('minUpvotes');
    const cacheExpiryInput = document.getElementById('cacheExpiryDays');
    const rateLimitInput = document.getElementById('rateLimitDelay');
    const statusDiv = document.getElementById('status');
    
    try {
        // Get current settings to check if min upvotes changed
        const currentSettings = await chrome.storage.sync.get([MIN_UPVOTES_KEY]);
        const oldMinUpvotes = currentSettings[MIN_UPVOTES_KEY] || 50;
        const newMinUpvotes = Math.max(1, parseInt(minUpvotesInput.value) || 50);
        
        // Handle API key
        const apiKey = apiKeyInput.value.trim();
        if (apiKey && apiKey !== MASKED_PLACEHOLDER) {
            await chrome.storage.sync.set({ [API_KEY_STORAGE_KEY]: apiKey });
            actualApiKey = apiKey;
            apiKeyInput.value = MASKED_PLACEHOLDER;
            apiKeyInput.type = 'password';
            isModified = false;
        } else if (!apiKey) {
            // If empty, remove the API key
            await chrome.storage.sync.remove(API_KEY_STORAGE_KEY);
            actualApiKey = '';
        }
        
        // Save numeric settings with validation
        const cacheExpiryDays = parseInt(cacheExpiryInput.value) || 7;
        const rateLimitDelay = parseInt(rateLimitInput.value) || 150;
        
        await chrome.storage.sync.set({
            [MIN_UPVOTES_KEY]: newMinUpvotes,
            [CACHE_EXPIRY_KEY]: Math.max(1, cacheExpiryDays),
            [RATE_LIMIT_KEY]: Math.max(0, rateLimitDelay)
        });
        
        // If min upvotes changed, clear cache entries with scores below new threshold
        if (oldMinUpvotes !== newMinUpvotes) {
            console.log(`Min upvotes changed from ${oldMinUpvotes} to ${newMinUpvotes}, clearing cache entries below new threshold.`);
            await updateCacheWithThreshold(newMinUpvotes);
        }
        
        showStatus('Settings saved successfully!', 'success');
    } catch (error) {
        showStatus('Error saving settings: ' + error.message, 'error');
    }
});

// Clear cache entries that have topScore below the new threshold
async function updateCacheWithThreshold(minUpvotes) {
    const CACHE_KEY_PREFIX = "so_q_";
    const allData = await chrome.storage.local.get(null);
    const keysToUpdateToTrue = [];
    const keysToUpdateToFalse = [];

    
    for (const key in allData) {
        console.log('Checking cache key:', key);
        if (key.startsWith(CACHE_KEY_PREFIX)) {
            const cached = allData[key];
            if (cached.topScore < minUpvotes && cached.hasGoodAnswer) {
                keysToUpdateToFalse.push(key);
            } else if (cached.topScore >= minUpvotes && !cached.hasGoodAnswer) {
                keysToUpdateToTrue.push(key);
            }
        }
    }

    for (const key of keysToUpdateToFalse) {
        const cached = allData[key];
        cached.hasGoodAnswer = false;
        await chrome.storage.local.set({ [key]: cached });
    }

    for (const key of keysToUpdateToTrue) {
        const cached = allData[key];
        cached.hasGoodAnswer = true;
        await chrome.storage.local.set({ [key]: cached });
    }
}

function showStatus(message, type) {
    const statusDiv = document.getElementById('status');
    statusDiv.textContent = message;
    statusDiv.className = 'status ' + type;
    statusDiv.style.display = 'block';
    
    // Hide after 3 seconds
    setTimeout(() => {
        statusDiv.style.display = 'none';
    }, 3000);
}
