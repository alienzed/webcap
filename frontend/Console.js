// Console.js - In-app console panel
// =============================================================================

class Console {
    constructor(app) {
        this.app = app;
        this.visible = false;
        this.entries = [];
        
        // Store original console methods
        this.originalConsole = {
            log: console.log.bind(console),
            warn: console.warn.bind(console),
            error: console.error.bind(console)
        };
        
        this.setupInterception();
        this.setupEventListeners();
    }

    setupInterception() {
        // Override console.log
        console.log = (...args) => {
            this.originalConsole.log.apply(console, args);
            const message = args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ');
            this.log('info', message);
        };

        // Override console.warn
        console.warn = (...args) => {
            this.originalConsole.warn.apply(console, args);
            const message = args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ');
            this.log('warn', message);
        };

        // Override console.error
        console.error = (...args) => {
            this.originalConsole.error.apply(console, args);
            const message = args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ');
            this.log('error', message);
        };

        // Capture uncaught errors
        window.addEventListener('error', (event) => {
            this.log('error', `Uncaught error: ${event.message} at ${event.filename}:${event.lineno}`);
        });

        // Capture unhandled promise rejections
        window.addEventListener('unhandledrejection', (event) => {
            this.log('error', `Unhandled promise rejection: ${event.reason}`);
        });
    }

    setupEventListeners() {
        document.getElementById('btnToggleConsole').addEventListener('click', () => {
            this.toggle();
        });

        document.getElementById('btnClearConsole').addEventListener('click', () => {
            this.clear();
        });
    }

    toggle(force) {
        const panel = document.getElementById('consolePanel');
        if (typeof force === 'boolean') {
            this.visible = force;
        } else {
            this.visible = !this.visible;
        }
        
        panel.style.display = this.visible ? 'flex' : 'none';
        document.getElementById('btnToggleConsole').textContent = this.visible ? '×' : '>';
    }

    clear() {
        this.entries = [];
        this.render();
    }

    log(level, message) {
        const entry = {
            level,
            message,
            timestamp: new Date().toISOString()
        };
        
        this.entries.push(entry);
        if (this.entries.length > 1000) {
            this.entries.shift();
        }
        
        this.render();
    }

    render() {
        const body = document.getElementById('consoleBody');
        body.innerHTML = this.entries.map(entry => {
            const time = new Date(entry.timestamp).toLocaleTimeString();
            const levelClass = `console-${entry.level}`;
            return `<div class="${levelClass}">[${time}] ${entry.message}</div>`;
        }).join('');
        body.scrollTop = body.scrollHeight;
    }
}
