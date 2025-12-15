console.log('StackOverflow annotator loaded');

(async function () {
    const API_BASE = "https://api.stackexchange.com/2.3";
    const SITE = "stackoverflow";
    const MIN_UPVOTES = 50;
    const CACHE_EXPIRY_DAYS = 7;
    const CACHE_KEY_PREFIX = "so_q_";
    const RATE_LIMIT_DELAY_MS = 150;

    // Utility: sleep to avoid API rate limits
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // Helper functions for chrome.storage
    async function getCachedQuestion(questionId) {
        const key = CACHE_KEY_PREFIX + questionId;
        const result = await chrome.storage.local.get(key);
        
        if (!result[key]) return null;
        
        const cached = result[key];
        const now = Date.now();
        const ageInDays = (now - cached.timestamp) / (1000 * 60 * 60 * 24);
        
        // Check if cache is expired (>7 days)
        if (ageInDays > CACHE_EXPIRY_DAYS) {
            await chrome.storage.local.remove(key);
            return null;
        }
        
        return cached;
    }

    async function setCachedQuestion(questionId, hasGoodAnswer, topScore) {
        const key = CACHE_KEY_PREFIX + questionId;
        await chrome.storage.local.set({
            [key]: {
                hasGoodAnswer,
                topScore,
                timestamp: Date.now()
            }
        });
    }

    // Clean up expired cache entries periodically
    async function cleanupExpiredCache() {
        const allData = await chrome.storage.local.get(null);
        const now = Date.now();
        const keysToRemove = [];
        
        for (const key in allData) {
            if (key.startsWith(CACHE_KEY_PREFIX)) {
                const cached = allData[key];
                const ageInDays = (now - cached.timestamp) / (1000 * 60 * 60 * 24);
                
                if (ageInDays > CACHE_EXPIRY_DAYS) {
                    keysToRemove.push(key);
                }
            }
        }
        
        if (keysToRemove.length > 0) {
            await chrome.storage.local.remove(keysToRemove);
            console.log(`Cleaned up ${keysToRemove.length} expired cache entries`);
        }
    }

    // Run cleanup on extension load
    cleanupExpiredCache();

    async function processLinks() {
        // Find all Google search result links that haven't been processed yet
        const results = document.querySelectorAll("a[href*='stackoverflow.com/questions']:not([data-so-annotated])");

        for (const result of results) {
            const link = result;
            // Mark as processed immediately
            link.setAttribute('data-so-annotated', 'true');

            const match = link.href.match(/questions\/(\d+)/);
            if (!match) continue;

            const questionId = match[1];

            try {
                let hasGoodAnswer = false;
                let topScore = 0;

                const cached = await getCachedQuestion(questionId);
                
                if (cached) {
                    console.log(`Cache hit for question ${questionId}`);
                    hasGoodAnswer = cached.hasGoodAnswer;
                    topScore = cached.topScore;
                } else {
                    const url = `${API_BASE}/questions/${questionId}/answers?order=desc&sort=votes&site=${SITE}`;
                    const res = await fetch(url);
                    const data = await res.json();

                    if (data.items && data.items.length > 0) {
                        const topAnswer = data.items[0];
                        topScore = topAnswer.score;
                        if (topAnswer.score >= MIN_UPVOTES) {
                            hasGoodAnswer = true;
                        }
                    }

                    await setCachedQuestion(questionId, hasGoodAnswer, topScore);
                    // Be polite to the API only when actually fetching
                    await sleep(RATE_LIMIT_DELAY_MS);
                }

                annotate(result, hasGoodAnswer, topScore);

            } catch (err) {
                console.error("SO Annotator error:", err);
            }
        }
    }

    // Run initially
    processLinks();

    // Watch for changes (e.g. pagination, infinite scroll)
    const observer = new MutationObserver((mutations) => {
        let shouldProcess = false;
        for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
                shouldProcess = true;
                break;
            }
        }
        if (shouldProcess) {
            processLinks();
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    function annotate(container, hasGoodAnswer, score) {
        // Avoid double annotation if called multiple times on same element
        if (container.querySelector('.so-annotator-badge')) return;

        const badge = document.createElement("span");
        badge.className = 'so-annotator-badge';

        const parentIsSpan = container.parentElement && container.parentElement.tagName === 'SPAN';

        // Check if container's parent is a span
        const transformValue = parentIsSpan ? 'scale(1, -1) translateY(-8px)' : 'none';
        const marginLeft = parentIsSpan ? '16px' : '8px';

        const commonStyles = `
            margin-left: ${marginLeft};
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 600;
            text-decoration: none;
            display: inline-block;
            vertical-align: middle;
            transform: ${transformValue};
            line-height: 1.2;
            white-space: nowrap;
            font-family: sans-serif;
            font-style: normal;
            direction: ltr;
        `;



        if (hasGoodAnswer) {
            badge.textContent = `✔ Good answer (${score} ⇑)`;
            badge.style.cssText = commonStyles + `
                background: #95c9a8;
                color: #2c3e36;
            `;
        } else {
            badge.textContent = score > 0 ? `⚠ Low votes (${score} ⇑)` : `✗ No good answer`;
            badge.style.cssText = commonStyles + `
                background: #d4a5a0;
                color: #4a3330;
            `;
        }

        // Append to the link itself to ensure the badge is removed if the link is re-rendered
        container.appendChild(badge);
    }
})();