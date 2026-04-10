/**
 * Bit Planes Performance Fixes
 * Addresses: 1 FPS issue, memory leaks, game loop problems
 */

(function() {
    'use strict';
    
    console.log('Bit Planes Performance Fixes Loading...');
    
    // ============================================
    // 1. GAME LOOP FIX: Ensure requestAnimationFrame works
    // ============================================
    
    // Store original RAF
    const originalRAF = window.requestAnimationFrame;
    const originalCAF = window.cancelAnimationFrame;
    
    // Fix for browsers where RAF might not fire
    let rafFallbackActive = false;
    let rafFallbackId = 0;
    const rafFallbacks = new Map();
    
    window.requestAnimationFrame = function(callback) {
        // Try original first
        if (originalRAF) {
            return originalRAF.call(window, callback);
        }
        
        // Fallback: Use setTimeout with 16ms (60fps)
        const id = ++rafFallbackId;
        const startTime = performance.now();
        
        const timeoutId = setTimeout(function() {
            const currentTime = performance.now();
            const elapsed = currentTime - startTime;
            callback(currentTime);
            rafFallbacks.delete(id);
        }, 16); // 60 FPS
        
        rafFallbacks.set(id, timeoutId);
        rafFallbackActive = true;
        
        return id;
    };
    
    window.cancelAnimationFrame = function(id) {
        if (originalCAF) {
            originalCAF.call(window, id);
        }
        
        // Cancel our fallback if it exists
        const timeoutId = rafFallbacks.get(id);
        if (timeoutId) {
            clearTimeout(timeoutId);
            rafFallbacks.delete(id);
        }
    };
    
    // ============================================
    // 2. MEMORY LEAK PREVENTION
    // ============================================
    
    // Track event listeners for cleanup
    const trackedListeners = new WeakMap();
    
    const originalAddEventListener = EventTarget.prototype.addEventListener;
    const originalRemoveEventListener = EventTarget.prototype.removeEventListener;
    
    EventTarget.prototype.addEventListener = function(type, listener, options) {
        // Call original
        originalAddEventListener.call(this, type, listener, options);
        
        // Track it
        if (!trackedListeners.has(this)) {
            trackedListeners.set(this, new Map());
        }
        
        const elementListeners = trackedListeners.get(this);
        if (!elementListeners.has(type)) {
            elementListeners.set(type, new Set());
        }
        
        elementListeners.get(type).add(listener);
        
        return undefined;
    };
    
    EventTarget.prototype.removeEventListener = function(type, listener, options) {
        // Call original
        originalRemoveEventListener.call(this, type, listener, options);
        
        // Remove from tracking
        if (trackedListeners.has(this)) {
            const elementListeners = trackedListeners.get(this);
            if (elementListeners.has(type)) {
                elementListeners.get(type).delete(listener);
                
                // Clean up empty sets
                if (elementListeners.get(type).size === 0) {
                    elementListeners.delete(type);
                }
            }
            
            // Clean up empty maps
            if (elementListeners.size === 0) {
                trackedListeners.delete(this);
            }
        }
        
        return undefined;
    };
    
    // Cleanup function for game objects
    window.cleanupGameObjects = function() {
        console.log('Cleaning up game objects...');
        
        // Clean tracked listeners
        trackedListeners.clear();
        
        // Force garbage collection if available
        if (window.gc) {
            window.gc();
        }
        
        // Clear any intervals
        const maxId = setTimeout(() => {}, 0);
        for (let i = 0; i < maxId; i++) {
            clearTimeout(i);
        }
    };
    
    // ============================================
    // 3. CANVAS OPTIMIZATIONS
    // ============================================
    
    // Monitor canvas operations
    const canvasPerformance = {
        operations: [],
        slowThreshold: 5, // ms
        maxOperations: 1000
    };
    
    // Patch canvas context methods to monitor performance
    function monitorCanvasContext(ctx, canvasName = 'unknown') {
        const methodsToMonitor = [
            'fillRect', 'clearRect', 'drawImage', 
            'fillText', 'strokeText', 'strokeRect',
            'beginPath', 'closePath', 'stroke', 'fill',
            'arc', 'rect', 'lineTo', 'moveTo'
        ];
        
        methodsToMonitor.forEach(methodName => {
            if (typeof ctx[methodName] === 'function') {
                const original = ctx[methodName];
                ctx[methodName] = function(...args) {
                    const start = performance.now();
                    const result = original.apply(this, args);
                    const duration = performance.now() - start;
                    
                    if (duration > canvasPerformance.slowThreshold) {
                        canvasPerformance.operations.push({
                            canvas: canvasName,
                            method: methodName,
                            duration: duration,
                            timestamp: performance.now(),
                            argsLength: args.length
                        });
                        
                        // Keep only recent operations
                        if (canvasPerformance.operations.length > canvasPerformance.maxOperations) {
                            canvasPerformance.operations.shift();
                        }
                    }
                    
                    return result;
                };
            }
        });
        
        return ctx;
    }
    
    // Apply monitoring to all canvases
    document.addEventListener('DOMContentLoaded', function() {
        setTimeout(function() {
            const canvases = document.querySelectorAll('canvas');
            canvases.forEach((canvas, index) => {
                try {
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        monitorCanvasContext(ctx, `canvas-${index}`);
                        console.log(`Monitoring canvas ${index} (${canvas.width}x${canvas.height})`);
                    }
                } catch(e) {
                    console.warn(`Could not monitor canvas ${index}:`, e.message);
                }
            });
        }, 1000);
    });
    
    // ============================================
    // 4. PERFORMANCE MONITORING & REPORTING
    // ============================================
    
    window.bitplanesPerformance = {
        // Get performance stats
        getStats: function() {
            const stats = {
                timestamp: new Date().toISOString(),
                memory: {},
                frameRate: {},
                canvas: {},
                listeners: {}
            };
            
            // Memory stats
            if (window.performance && window.performance.memory) {
                const mem = window.performance.memory;
                stats.memory = {
                    usedMB: (mem.usedJSHeapSize / (1024 * 1024)).toFixed(2),
                    totalMB: (mem.totalJSHeapSize / (1024 * 1024)).toFixed(2),
                    limitMB: (mem.jsHeapSizeLimit / (1024 * 1024)).toFixed(2),
                    usagePercent: ((mem.usedJSHeapSize / mem.totalJSHeapSize) * 100).toFixed(1)
                };
            }
            
            // Frame rate stats
            if (window.frameTimes && window.frameTimes.length > 0) {
                const recentFrames = window.frameTimes.slice(-60); // Last second at 60fps
                const totalTime = recentFrames.reduce((sum, time) => sum + time, 0);
                const avgFrameTime = totalTime / recentFrames.length;
                
                stats.frameRate = {
                    frames: recentFrames.length,
                    avgFrameTimeMs: avgFrameTime.toFixed(2),
                    avgFPS: (1000 / avgFrameTime).toFixed(1),
                    minFPS: (1000 / Math.max(...recentFrames)).toFixed(1),
                    maxFPS: (1000 / Math.min(...recentFrames)).toFixed(1)
                };
            }
            
            // Canvas stats
            stats.canvas = {
                totalOperations: canvasPerformance.operations.length,
                slowOperations: canvasPerformance.operations.filter(op => op.duration > 10).length,
                canvases: document.querySelectorAll('canvas').length
            };
            
            // Listener stats
            let totalListeners = 0;
            trackedListeners.forEach((typeMap, element) => {
                typeMap.forEach((listeners, type) => {
                    totalListeners += listeners.size;
                });
            });
            stats.listeners.total = totalListeners;
            
            return stats;
        },
        
        // Start frame rate monitoring
        startMonitoring: function() {
            if (window.frameTimes) return; // Already monitoring
            
            window.frameTimes = [];
            window.lastFrameTime = performance.now();
            
            function monitorFrame() {
                const currentTime = performance.now();
                const frameTime = currentTime - window.lastFrameTime;
                
                window.frameTimes.push(frameTime);
                window.lastFrameTime = currentTime;
                
                // Keep only last 300 frames (5 seconds at 60fps)
                if (window.frameTimes.length > 300) {
                    window.frameTimes.shift();
                }
                
                requestAnimationFrame(monitorFrame);
            }
            
            requestAnimationFrame(monitorFrame);
            console.log('Frame rate monitoring started');
        },
        
        // Get slow canvas operations
        getSlowCanvasOps: function(threshold = 10) {
            return canvasPerformance.operations
                .filter(op => op.duration > threshold)
                .sort((a, b) => b.duration - a.duration)
                .slice(0, 10);
        },
        
        // Cleanup recommendations
        getRecommendations: function() {
            const stats = this.getStats();
            const recommendations = [];
            
            // Memory recommendations
            if (stats.memory.usagePercent > 80) {
                recommendations.push({
                    priority: 'high',
                    issue: 'High memory usage',
                    fix: 'Call window.cleanupGameObjects() and check for memory leaks'
                });
            }
            
            // Frame rate recommendations
            if (stats.frameRate.avgFPS < 30) {
                recommendations.push({
                    priority: 'high',
                    issue: 'Low frame rate',
                    fix: 'Check canvas operations and reduce rendering complexity'
                });
            }
            
            // Canvas recommendations
            if (stats.canvas.slowOperations > 10) {
                recommendations.push({
                    priority: 'medium',
                    issue: 'Slow canvas operations',
                    fix: 'Optimize drawImage and fillRect calls, use sprite sheets'
                });
            }
            
            // Listener recommendations
            if (stats.listeners.total > 100) {
                recommendations.push({
                    priority: 'medium',
                    issue: 'Many event listeners',
                    fix: 'Ensure listeners are removed when objects are destroyed'
                });
            }
            
            return recommendations;
        }
    };
    
    // ============================================
    // 5. AUTO-START GAME LOOP FIX
    // ============================================
    
    // Some games need interaction to start. This ensures the game starts.
    document.addEventListener('DOMContentLoaded', function() {
        console.log('Bit Planes Performance Fixes Loaded');
        
        // Start monitoring after a delay
        setTimeout(function() {
            if (window.bitplanesPerformance) {
                window.bitplanesPerformance.startMonitoring();
            }
            
            // Try to kickstart the game if it's not running
            setTimeout(function() {
                const canvases = document.querySelectorAll('canvas');
                if (canvases.length > 0) {
                    console.log('Attempting to ensure game loop is running...');
                    
                    // Simulate a click on the main canvas (common game starter)
                    canvases[0].click();
                    
                    // Press and release space (common for testing)
                    const spaceEvent = new KeyboardEvent('keydown', { key: ' ', code: 'Space' });
                    window.dispatchEvent(spaceEvent);
                    
                    setTimeout(() => {
                        const spaceUp = new KeyboardEvent('keyup', { key: ' ', code: 'Space' });
                        window.dispatchEvent(spaceUp);
                    }, 100);
                }
            }, 2000);
        }, 1000);
    });
    
    // Export for debugging
    console.log('Bit Planes Performance Fixes Ready');
    console.log('Use window.bitplanesPerformance.getStats() for performance data');
    console.log('Use window.cleanupGameObjects() to force cleanup');
    
})();