// Bit Planes Audio Manager
// Using Howler.js for cross-browser compatibility

class AudioManager {
    constructor() {
        this.sounds = {};
        this.music = null;
        this.masterVolume = 1.0;
        this.sfxVolume = 1.0;
        this.musicVolume = 0.7;
        this.muted = false;
        this.initialized = false;
        
        // Audio pool for frequently played sounds
        this.audioPools = {};
        this.maxConcurrentSounds = 8;
        this.currentSounds = 0;
    }
    
    // Initialize the audio system
    init() {
        if (this.initialized) return;
        
        console.log('Initializing Bit Planes Audio System...');
        
        // Load all sound effects
        this.loadSounds();
        
        // Setup event listeners for game events
        this.setupEventListeners();
        
        this.initialized = true;
        console.log('Audio system initialized successfully');
    }
    
    // Load all sound effects
    loadSounds() {
        // Create audio pools for frequently played sounds
        this.createAudioPool('machine_gun', 3);
        this.createAudioPool('explosion', 5);
        this.createAudioPool('hit', 3);
        
        // Individual sounds
        this.sounds.click = new Howl({
            src: ['sounds/click.wav'],
            volume: 0.8,
            preload: true
        });
        
        this.sounds.engine = new Howl({
            src: ['sounds/engine.wav'],
            volume: 0.6,
            loop: true,
            preload: true
        });
        
        this.sounds.laser = new Howl({
            src: ['sounds/laser.wav'],
            volume: 0.9,
            preload: true
        });
        
        this.sounds.cannon = new Howl({
            src: ['sounds/cannon.wav'],
            volume: 1.0,
            preload: true
        });
        
        // Load pooled sounds
        this.loadPooledSound('machine_gun', 'sounds/machine_gun.wav', 0.7);
        this.loadPooledSound('explosion', 'sounds/explosion.wav', 1.0);
        this.loadPooledSound('hit', 'sounds/hit.wav', 0.8);
    }
    
    // Create an audio pool for frequently played sounds
    createAudioPool(soundName, poolSize) {
        this.audioPools[soundName] = {
            pool: [],
            currentIndex: 0,
            size: poolSize
        };
    }
    
    // Load a sound into a pool
    loadPooledSound(poolName, src, volume = 1.0) {
        const pool = this.audioPools[poolName];
        if (!pool) {
            console.error(`Audio pool ${poolName} not found`);
            return;
        }
        
        for (let i = 0; i < pool.size; i++) {
            const sound = new Howl({
                src: [src],
                volume: volume,
                preload: true,
                onend: () => {
                    this.currentSounds--;
                }
            });
            pool.pool.push(sound);
        }
        
        // Also store as regular sound for single playback
        this.sounds[poolName] = pool.pool[0];
    }
    
    // Play a sound from a pool
    playFromPool(poolName, options = {}) {
        if (this.muted || !this.audioPools[poolName]) return null;
        
        if (this.currentSounds >= this.maxConcurrentSounds) {
            // Too many sounds playing, skip this one
            return null;
        }
        
        const pool = this.audioPools[poolName];
        const sound = pool.pool[pool.currentIndex];
        
        // Apply volume
        const volume = this.sfxVolume * (options.volume || 1);
        sound.volume(volume);
        
        // Play the sound
        sound.play();
        
        // Update pool index
        pool.currentIndex = (pool.currentIndex + 1) % pool.size;
        
        this.currentSounds++;
        return sound;
    }
    
    // Play a sound effect
    playSound(name, options = {}) {
        if (this.muted || !this.sounds[name]) return null;
        
        if (this.currentSounds >= this.maxConcurrentSounds) {
            // Too many sounds playing, skip this one
            return null;
        }
        
        const sound = this.sounds[name];
        
        // Apply volume
        const volume = this.sfxVolume * (options.volume || 1);
        sound.volume(volume);
        
        // Apply pitch if specified
        if (options.pitch) {
            sound.rate(options.pitch);
        }
        
        // Play the sound
        const soundId = sound.play();
        
        this.currentSounds++;
        
        // Set up cleanup when sound ends
        sound.once('end', () => {
            this.currentSounds--;
        }, soundId);
        
        return soundId;
    }
    
    // Play engine sound (special handling for looping)
    playEngine(volume = 0.6) {
        if (this.muted || !this.sounds.engine) return;
        
        if (!this.sounds.engine.playing()) {
            this.sounds.engine.volume(this.sfxVolume * volume);
            this.sounds.engine.play();
        }
    }
    
    // Stop engine sound
    stopEngine() {
        if (this.sounds.engine && this.sounds.engine.playing()) {
            this.sounds.engine.stop();
        }
    }
    
    // Play UI click sound
    playClick() {
        this.playSound('click', { volume: 0.8 });
    }
    
    // Play weapon sounds
    playMachineGun() {
        return this.playFromPool('machine_gun', { volume: 0.7 });
    }
    
    playLaser() {
        return this.playSound('laser', { volume: 0.9 });
    }
    
    playCannon() {
        return this.playSound('cannon', { volume: 1.0 });
    }
    
    // Play impact/explosion sounds
    playExplosion(size = 'medium') {
        let volume = 1.0;
        let pitch = 1.0;
        
        // Adjust based on explosion size
        switch (size) {
            case 'small':
                volume = 0.7;
                pitch = 1.2;
                break;
            case 'large':
                volume = 1.2;
                pitch = 0.8;
                break;
        }
        
        return this.playFromPool('explosion', { volume, pitch });
    }
    
    playHit() {
        return this.playFromPool('hit', { volume: 0.8 });
    }
    
    // Volume control methods
    setMasterVolume(volume) {
        this.masterVolume = Math.max(0, Math.min(1, volume));
        this.updateAllVolumes();
    }
    
    setSfxVolume(volume) {
        this.sfxVolume = Math.max(0, Math.min(1, volume));
        this.updateAllVolumes();
    }
    
    setMusicVolume(volume) {
        this.musicVolume = Math.max(0, Math.min(1, volume));
        if (this.music) {
            this.music.volume(this.musicVolume * this.masterVolume);
        }
    }
    
    updateAllVolumes() {
        // Update all sounds with new volume
        Object.values(this.sounds).forEach(sound => {
            if (sound && sound.volume) {
                // Get the base volume from the sound's initial settings
                const baseVolume = sound._volume || 1;
                sound.volume(baseVolume * this.sfxVolume * this.masterVolume);
            }
        });
        
        // Update pooled sounds
        Object.values(this.audioPools).forEach(pool => {
            pool.pool.forEach(sound => {
                if (sound && sound.volume) {
                    const baseVolume = sound._volume || 1;
                    sound.volume(baseVolume * this.sfxVolume * this.masterVolume);
                }
            });
        });
        
        // Update music
        if (this.music) {
            this.music.volume(this.musicVolume * this.masterVolume);
        }
    }
    
    // Mute/unmute
    toggleMute() {
        this.muted = !this.muted;
        Howler.mute(this.muted);
        return this.muted;
    }
    
    setMute(muted) {
        this.muted = muted;
        Howler.mute(muted);
    }
    
    // Setup event listeners for game events
    setupEventListeners() {
        // Listen for custom game events
        document.addEventListener('bitplanes:shoot', (event) => {
            const weaponType = event.detail?.weapon || 'machine_gun';
            this.playWeaponSound(weaponType);
        });
        
        document.addEventListener('bitplanes:explosion', (event) => {
            const size = event.detail?.size || 'medium';
            this.playExplosion(size);
        });
        
        document.addEventListener('bitplanes:hit', () => {
            this.playHit();
        });
        
        document.addEventListener('bitplanes:engine', (event) => {
            const throttle = event.detail?.throttle || 0;
            if (throttle > 0) {
                this.playEngine(0.3 + (throttle * 0.4));
            } else {
                this.stopEngine();
            }
        });
        
        document.addEventListener('bitplanes:ui-click', () => {
            this.playClick();
        });
        
        // Listen for actual game events by hooking into the game
        this.hookIntoGameEvents();
    }
    
    // Hook into actual game events
    hookIntoGameEvents() {
        // This will be called after the game is loaded
        // We'll override game methods to add audio triggers
        setTimeout(() => {
            this.injectAudioHooks();
        }, 1000);
    }
    
    // Inject audio hooks into the game
    injectAudioHooks() {
        console.log('Injecting audio hooks into Bit Planes game...');
        
        // Try to find and hook into game objects
        // This is a bit hacky but necessary for minified code
        
        // Method 1: Override canvas context drawing
        this.hookCanvasEvents();
        
        // Method 2: Listen for keyboard events
        this.hookKeyboardEvents();
        
        // Method 3: Override game object methods if we can find them
        this.findAndHookGameMethods();
    }
    
    // Hook into canvas drawing events
    hookCanvasEvents() {
        const canvas = document.getElementById('canvas');
        if (!canvas) return;
        
        const originalGetContext = canvas.getContext.bind(canvas);
        canvas.getContext = function(type, attributes) {
            const context = originalGetContext(type, attributes);
            
            if (type === '2d') {
                // We could hook drawImage or other methods to detect explosions
                // For now, we'll use a simpler approach
            }
            
            return context;
        };
    }
    
    // Hook keyboard events for shooting
    hookKeyboardEvents() {
        let lastSpacePress = 0;
        let lastXPress = 0;
        
        document.addEventListener('keydown', (event) => {
            const now = Date.now();
            
            // Space bar for machine gun
            if (event.code === 'Space' && now - lastSpacePress > 100) {
                lastSpacePress = now;
                this.playMachineGun();
                
                // Dispatch custom event
                document.dispatchEvent(new CustomEvent('bitplanes:shoot', {
                    detail: { weapon: 'machine_gun' }
                }));
            }
            
            // X for cannon/missile
            if (event.code === 'KeyX' && now - lastXPress > 500) {
                lastXPress = now;
                this.playCannon();
                
                // Dispatch custom event
                document.dispatchEvent(new CustomEvent('bitplanes:shoot', {
                    detail: { weapon: 'cannon' }
                }));
            }
            
            // Arrow keys for engine
            if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
                document.dispatchEvent(new CustomEvent('bitplanes:engine', {
                    detail: { throttle: 0.5 }
                }));
            }
        });
        
        document.addEventListener('keyup', (event) => {
            if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
                document.dispatchEvent(new CustomEvent('bitplanes:engine', {
                    detail: { throttle: 0 }
                }));
            }
        });
    }
    
    // Try to find and hook game methods
    findAndHookGameMethods() {
        // Look for game objects in the global scope
        const gameObjects = [];
        
        // Check window object for game-related properties
        for (const key in window) {
            if (key.includes('game') || key.includes('Game') || 
                key.includes('plane') || key.includes('Plane')) {
                gameObjects.push({ key, value: window[key] });
            }
        }
        
        console.log('Found potential game objects:', gameObjects.length);
        
        // If we find a game object, try to hook into its methods
        gameObjects.forEach(obj => {
            if (obj.value && typeof obj.value === 'object') {
                this.tryHookObjectMethods(obj.value);
            }
        });
    }
    
    // Try to hook methods on an object
    tryHookObjectMethods(obj) {
        // Look for methods that might be related to game events
        const methodNames = ['shoot', 'fire', 'explode', 'hit', 'crash', 'update'];
        
        methodNames.forEach(methodName => {
            if (typeof obj[methodName] === 'function') {
                console.log(`Found method ${methodName} on game object`);
                
                // Store original method
                const originalMethod = obj[methodName].bind(obj);
                
                // Override with audio hook
                obj[methodName] = function(...args) {
                    // Call original method
                    const result = originalMethod(...args);
                    
                    // Trigger audio based on method
                    switch (methodName) {
                        case 'shoot':
                        case 'fire':
                            document.dispatchEvent(new CustomEvent('bitplanes:shoot'));
                            break;
                        case 'explode':
                        case 'crash':
                            document.dispatchEvent(new CustomEvent('bitplanes:explosion'));
                            break;
                        case 'hit':
                            document.dispatchEvent(new CustomEvent('bitplanes:hit'));
                            break;
                    }
                    
                    return result;
                };
            }
        });
    }
    
    // Play weapon sound based on type
    playWeaponSound(weaponType) {
        switch (weaponType) {
            case 'machine_gun':
                this.playMachineGun();
                break;
            case 'laser':
                this.playLaser();
                break;
            case 'cannon':
            case 'missile':
                this.playCannon();
                break;
            default:
                this.playMachineGun();
        }
    }
    
    // Cleanup
    destroy() {
        // Stop all sounds
        Howler.stop();
        
        // Unload all sounds
        Object.values(this.sounds).forEach(sound => {
            if (sound && sound.unload) {
                sound.unload();
            }
        });
        
        // Unload pooled sounds
        Object.values(this.audioPools).forEach(pool => {
            pool.pool.forEach(sound => {
                if (sound && sound.unload) {
                    sound.unload();
                }
            });
        });
        
        this.sounds = {};
        this.audioPools = {};
        this.initialized = false;
    }
}

// Create global audio manager instance
window.bitplanesAudio = new AudioManager();

// Initialize when page loads
window.addEventListener('load', () => {
    // Load Howler.js if not already loaded
    if (typeof Howl === 'undefined') {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/howler/2.2.4/howler.min.js';
        script.onload = () => {
            window.bitplanesAudio.init();
        };
        document.head.appendChild(script);
    } else {
        window.bitplanesAudio.init();
    }
});

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AudioManager;
}