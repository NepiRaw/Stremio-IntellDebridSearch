const STYLESHEET = `
        /* Define CSS Variables for the new theme */
        :root {
            --color-dark-blue-bg: #0C1226; /* Very dark blue for main background */
            --color-medium-blue-bg: #1A223F; /* Medium dark blue for containers */
            --color-light-blue-bg: #2B355A; /* Slightly lighter blue for sections */
            --color-accent-blue: #4A90E2; /* Vibrant blue for accents/highlights */
            --color-text-light: #E0F7FA; /* Light cyan for primary text */
            --color-text-medium: #A0B3D6; /* Medium blue-grey for secondary text */
            --color-border-subtle: rgba(74, 144, 226, 0.2); /* Subtle blue for borders */
            --color-border-strong: rgba(74, 144, 226, 0.5); /* Stronger blue for active borders */
            --color-gradient-start: #4A90E2; /* Gradient start for titles/success */
            --color-gradient-end: #2561C8; /* Gradient end for titles/success */
            --color-toggle-off: #192A4A; /* Dark blue for toggle off state */
            --color-toggle-on: #4A90E2; /* Accent blue for toggle on state */
            --color-shadow: rgba(0, 0, 0, 0.4); /* General shadow color */
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Roboto', sans-serif;
            background: linear-gradient(135deg, var(--color-dark-blue-bg) 0%, var(--color-medium-blue-bg) 100%);
            color: var(--color-text-light);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }

        .container {
            background: rgba(12, 18, 38, 0.9); /* Use var(--color-dark-blue-bg) with opacity */
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 40px;
            box-shadow: 0 20px 40px var(--color-shadow);
            text-align: center;
            max-width: 700px;
            width: 100%;
            animation: slideUp 0.6s ease-out;
            border: 1px solid var(--color-border-subtle);
        }

        @keyframes slideUp {
            from {
                opacity: 0;
                transform: translateY(30px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        .logo {
            max-width: 120px;
            height: auto;
            margin-bottom: 20px;
            filter: drop-shadow(0 2px 4px var(--color-shadow));
        }

        h1 {
            color: #fff;
            font-size: 2.5rem;
            margin-bottom: 10px;
            font-weight: 700;
            text-shadow: 0 2px 4px var(--color-shadow);
            background: linear-gradient(90deg, var(--color-gradient-start) 30%, var(--color-gradient-end) 100%);
            background-clip: text;
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }

        .version {
            color: var(--color-text-medium);
            font-size: 1rem;
            margin-bottom: 25px;
            font-weight: 300;
            letter-spacing: 0.5px;
        }

        .description {
            color: var(--color-text-medium);
            font-size: 1.2rem;
            line-height: 1.6;
            margin-bottom: 30px;
        }
        
        .api-keys-section {
            background: rgba(26, 34, 63, 0.8); /* Use var(--color-medium-blue-bg) with opacity */
            border-radius: 15px;
            padding: 25px;
            margin-bottom: 30px;
            border: 1px solid var(--color-border-subtle);
            text-align: center;
            position: relative;
            overflow: hidden;
        }

        .api-keys-section::before {
            content: "";
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(45deg, transparent 50%, rgba(74, 144, 226, 0.1) 100%); /* Use var(--color-accent-blue) with opacity */
            pointer-events: none;
        }

        .api-keys-section h3 {
            color: var(--color-accent-blue);
            margin-bottom: 20px;
            font-size: 1.4rem;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
        }

        .api-keys-grid {
            display: grid;
            grid-template-columns: repeat(6, 1fr); /* 6 columns for flexibility */
            gap: 15px;
            margin-top: 15px;
        }

        .api-key-button {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 14px 10px;
            background: rgba(74, 144, 226, 0.2); /* Use var(--color-accent-blue) with opacity */
            border: 1px solid rgba(74, 144, 226, 0.4); /* Use var(--color-accent-blue) with opacity */
            border-radius: 10px;
            color: var(--color-text-light);
            text-decoration: none;
            font-weight: 500;
            transition: all 0.3s ease;
            text-align: center;
            min-height: 60px;
            backdrop-filter: blur(4px);
            position: relative;
            overflow: hidden;
            grid-column: span 2; /* Default: each button spans 2 columns */
        }

        /* Last two buttons in the grid */
        .api-keys-grid a:nth-last-child(-n+2) {
            grid-column: span 3; /* Each spans 3 columns (1.5x the default) */
        }

        .api-key-button:hover {
            background: rgba(74, 144, 226, 0.3); /* Lighter blue hover background */
            transform: translateY(-3px);
            box-shadow: 0 5px 15px rgba(74, 144, 226, 0.3); /* Blue shadow */
            border-color: rgba(74, 144, 226, 0.7); /* Lighter blue hover border */
        }

        .api-key-button::before {
            content: "";
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
            transition: 0.5s;
        }

        .api-key-button:hover::before {
            left: 100%;
        }

        .api-key-button i {
            font-size: 1.1rem;
            color: var(--color-accent-blue);
        }

        /* Media Queries for Responsive Grid */
        @media (max-width: 768px) {
            .api-keys-grid {
                grid-template-columns: repeat(2, 1fr);
            }
            .api-key-button {
                grid-column: span 1;
            }
            .api-keys-grid a:nth-last-child(-n+2) {
                grid-column: span 1;
            }
        }

        @media (max-width: 480px) {
            .api-keys-grid {
                grid-template-columns: 1fr;
            }
        }

        .config-section {
            margin: 30px 0;
            padding: 25px;
            background: rgba(12, 18, 38, 0.6); /* Use var(--color-dark-blue-bg) with opacity */
            border-radius: 15px;
            box-shadow: 0 5px 15px var(--color-shadow);
            border: 1px solid var(--color-border-subtle);
        }

        .config-group {
            margin-bottom: 20px;
            text-align: left;
        }

        .config-label {
            display: block;
            font-weight: 600;
            font-size: 16px;
            color: var(--color-text-light);
            margin-bottom: 8px;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        /* Custom Animated Dropdown Styles */
        .dropdown {
            position: relative;
            width: 100%;
        }
        
        .dropdown-btn {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 14px 20px;
            background: rgba(74, 144, 226, 0.15); /* Use var(--color-accent-blue) with opacity */
            border: 1px solid var(--color-border-strong);
            border-radius: 12px;
            color: var(--color-text-light);
            width: 100%;
            cursor: pointer;
            transition: all 0.2s ease;
            box-shadow: 0 2px 4px var(--color-shadow);
            font-size: 15px;
            text-align: left;
        }
        
        .dropdown-btn:hover {
            background: rgba(74, 144, 226, 0.25); /* Use var(--color-accent-blue) with opacity */
            border-color: var(--color-accent-blue);
            box-shadow: 0 0 10px rgba(74, 144, 226, 0.4); /* Use var(--color-accent-blue) with opacity */
        }
        
        .dropdown-content {
            position: absolute;
            top: 100%;
            left: 0;
            width: 100%;
            background: var(--color-dark-blue-bg);
            border: 1px solid var(--color-border-strong);
            border-radius: 12px;
            margin-top: 8px;
            overflow: hidden;
            z-index: 100;
            box-shadow: 0 10px 25px var(--color-shadow);
            max-height: 0;
            opacity: 0;
            transition: 
                max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1),
                opacity 0.2s ease;
        }
        
        .dropdown-content.open {
            max-height: 300px; /* Adjust as needed for content */
            opacity: 1;
        }
        
        .dropdown-item { /* This class is now for the debrid provider dropdown items */
            padding: 14px 20px;
            color: var(--color-text-light);
            cursor: pointer;
            transform: translateY(-10px);
            opacity: 0;
            transition: 
                transform 0.15s ease-out,
                opacity 0.15s ease-out,
                background 0s ease,
                padding 0s ease;
        }
        
        .dropdown-content.open .dropdown-item {
            transform: translateY(0);
            opacity: 1;
            transition-delay: calc(0.03s * var(--i));
        }
        
        /* Instant hover effect for debrid dropdown items */
        .dropdown-item:hover {
            background: rgba(74, 144, 226, 0.3) !important; /* Use var(--color-accent-blue) with opacity */
            padding-left: 25px !important;
        }
        
        .dropdown-item:not(:last-child) {
            border-bottom: 1px solid var(--color-border-subtle);
        }
        
        .chevron {
            transition: transform 0.2s ease;
            color: var(--color-accent-blue);
        }
        
        .chevron.rotate {
            transform: rotate(180deg);
        }

        /* Input field style */
        .api-key-input-container {
            position: relative;
            width: 100%;
        }
        
        input[type="text"],
        input[type="password"] {
            width: 100%;
            padding: 14px 16px;
            border-radius: 12px;
            font-size: 15px;
            background-color: rgba(74, 144, 226, 0.15); /* Use var(--color-accent-blue) with opacity */
            color: var(--color-text-light);
            transition: all 0.3s ease;
            cursor: text;
            box-shadow: 0 2px 4px var(--color-shadow);
            border: 1px solid var(--color-border-strong);
            padding-right: 45px; /* Make space for the icon */
        }
        
        .toggle-password {
            position: absolute;
            right: 15px;
            top: 50%;
            transform: translateY(-50%);
            cursor: pointer;
            color: var(--color-text-medium);
            transition: color 0.2s ease;
        }

        .toggle-password:hover {
            color: var(--color-accent-blue);
        }

        /* Fix for browser autofill background and text color */
        input:-webkit-autofill,
        input:-webkit-autofill:hover, 
        input:-webkit-autofill:focus, 
        input:-webkit-autofill:active {
            -webkit-box-shadow: 0 0 0px 1000px rgba(74, 144, 226, 0.15) inset !important;
            -webkit-text-fill-color: var(--color-text-light) !important;
            background-color: rgba(74, 144, 226, 0.15) !important;
            transition: background-color 5000s ease-in-out 0s !important;
            caret-color: var(--color-text-light) !important;
        }

        /* Placeholder text color */
        input::placeholder { /* For modern browsers */
            color: var(--color-text-medium);
            opacity: 0.7;
        }
        input::-webkit-input-placeholder { /* For Chrome, Safari, Edge */
            color: var(--color-text-medium);
            opacity: 0.7;
        }
        input::-moz-placeholder { /* For Firefox */
            color: var(--color-text-medium);
            opacity: 0.7;
        }
        input:-ms-input-placeholder { /* For Internet Explorer 10-11 */
            color: var(--color-text-medium);
            opacity: 0.7;
        }

        input[type="text"]:hover,
        input[type="password"]:hover {
            border-color: var(--color-accent-blue);
            box-shadow: 0 0 10px rgba(74, 144, 226, 0.4); /* Use var(--color-accent-blue) with opacity */
            background-color: rgba(74, 144, 226, 0.15);
        }

        input[type="text"]:focus,
        input[type="password"]:focus {
            outline: none;
            border-color: var(--color-accent-blue);
            box-shadow: 0 0 15px rgba(74, 144, 226, 0.6); /* Use var(--color-accent-blue) with opacity */
            background-color: rgba(74, 144, 226, 0.15);
        }

        input.error {
            border-color: #ff4444 !important;
            box-shadow: 0 0 10px rgba(255, 68, 68, 0.4) !important;
        }

        input.success {
            border-color: #44ff44 !important;
            box-shadow: 0 0 10px rgba(68, 255, 68, 0.3) !important;
        }

        .toggle-group {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 8px 12px 15px;
            background: rgba(74, 144, 226, 0.4); /* Use var(--color-accent-blue) with opacity */
            border-radius: 10px;
            transition: all 0.3s ease;
            position: relative;
            flex-grow: 1;
            border: 1px solid var(--color-border-subtle);
            cursor: pointer;
        }

        .toggle-group:hover {
            background: rgba(74, 144, 226, 0.6); /* Use var(--color-accent-blue) with opacity */
        }

        .toggle-label-text {
            display: flex;
            align-items: center;
            gap: 12px;
            color: var(--color-text-light);
            font-weight: 500;
            position: relative;
            flex-grow: 1;
            text-align: left;
        }

        .toggle-label-text i {
            color: var(--color-accent-blue);
            width: 20px;
            text-align: center;
        }
        
        .toggle-switch {
            position: relative;
            display: inline-block;
            width: 50px;
            height: 24px;
            flex-shrink: 0;
        }

        .toggle-switch input {
            opacity: 0;
            width: 0;
            height: 0;
        }

        .slider {
            position: absolute;
            cursor: pointer;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: var(--color-toggle-off);
            transition: .4s;
            border-radius: 24px;
        }

        .slider:before {
            position: absolute;
            content: "";
            height: 18px;
            width: 18px;
            left: 3px;
            bottom: 3px;
            background-color: white;
            transition: .4s;
            border-radius: 50%;
        }

        input:checked + .slider {
            background-color: var(--color-toggle-on);
        }

        input:checked + .slider:before {
            transform: translateX(26px);
        }

        .install-container {
            display: inline-flex;
            position: relative;
            margin-top: 20px;
            background: linear-gradient(45deg, var(--color-medium-blue-bg), var(--color-light-blue-bg));
            border-radius: 50px;
            box-shadow: 0 5px 15px var(--color-shadow);
        }

        .install-button {
            background: transparent;
            color: var(--color-text-light);
            border: none;
            padding: 16px 45px;
            font-size: 1.2rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            gap: 10px;
            position: relative;
            z-index: 1;
            border-radius: 50px 0 0 50px;
        }
        
        .install-button.success {
            background: var(--color-gradient-start); /* Use accent blue for success state */
            pointer-events: none;
        }

        .install-button:hover {
            background: rgba(74, 144, 226, 0.2); /* Use var(--color-accent-blue) with opacity */
        }

        .dropdown-toggle {
            background: rgba(0, 0, 0, 0.2);
            color: var(--color-text-light);
            border: none;
            padding: 0 20px;
            cursor: pointer;
            transition: all 0.3s ease;
            border-left: 1px solid rgba(255, 255, 255, 0.1);
            display: flex;
            align-items: center;
            border-radius: 0 50px 50px 0;
        }

        .dropdown-toggle:hover {
            background: rgba(74, 144, 226, 0.3); /* Use var(--color-accent-blue) with opacity */
        }

        .dropdown-menu {
            position: absolute;
            top: 100%;
            right: 0;
            background: var(--color-medium-blue-bg);
            border-radius: 12px;
            box-shadow: 0 4px 12px var(--color-shadow);
            width: 240px;
            z-index: 10;
            display: none;
            margin-top: 5px;
            border: 1px solid var(--color-border-subtle);
            max-height: 200px; /* Limit height to enable scrolling */
            overflow-y: auto; /* Enable vertical scrolling */
        }

        .dropdown-menu::before {
            content: '';
            position: absolute;
            top: -10px;
            right: 20px;
            width: 0;
            height: 0;
            border-left: 10px solid transparent;
            border-right: 10px solid transparent;
            border-bottom: 10px solid var(--color-medium-blue-bg);
        }

        .dropdown-menu.show {
            display: block;
            animation: fadeIn 0.3s ease;
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(-5px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .dropdown-item-menu { /* This class is now for the install dropdown items */
            padding: 15px 20px;
            text-align: left;
            display: flex;
            align-items: center;
            gap: 12px;
            color: var(--color-text-light);
            text-decoration: none;
            transition: all 0.2s ease;
        }

        .dropdown-item-menu:not(:last-child) {
            border-bottom: 1px solid var(--color-border-subtle);
        }

        .dropdown-item-menu:hover {
            background: rgba(74, 144, 226, 0.1); /* Use var(--color-accent-blue) with opacity */
            padding-left: 25px;
            color: var(--color-text-light);
        }

        .notification {
            position: fixed;
            top: 20px;
            right: 20px;
            background: var(--color-accent-blue);
            color: white;
            padding: 15px 25px;
            border-radius: 12px;
            box-shadow: 0 5px 15px var(--color-shadow);
            display: flex;
            align-items: center;
            gap: 10px;
            z-index: 1000;
            transform: translateX(150%);
            transition: transform 0.3s ease, background 0.3s ease;
        }

        .notification.show {
            transform: translateX(0);
        }

        .notification-success {
            background: #28a745;
        }

        .notification-error {
            background: #dc3545;
        }

        .notification-warning {
            background: #fd7e14;
        }

        .notification-info {
            background: var(--color-accent-blue);
        }

        .footer-badge {
            margin-top: 30px;
        }
        
        .footer-badge img {
            height: 28px;
        }

        @media (max-width: 768px) {
            .container { padding: 20px; margin: 10px; }
            h1 { font-size: 2rem; }
            .description { font-size: 1.1rem; }
            .install-container { flex-direction: column; border-radius: 12px; width: 100%; }
            .install-button { padding: 14px; justify-content: center; border-radius: 12px 12px 0 0; font-size: 1.1rem; }
            .dropdown-toggle { 
                padding: 12px; 
                border-left: none; 
                border-top: 1px solid rgba(255, 255, 255, 0.1); 
                border-radius: 0 0 12px 12px; 
                width: 100%;
                justify-content: center;
            }
            .dropdown-menu { width: 100%; right: 0; }
            .toggle-switch { width: 40px; height: 20px; }
            .slider:before { height: 14px; width: 14px; left: 3px; bottom: 3px; }
            input:checked + .slider:before { transform: translateX(20px); }
        }

        @media (max-width: 480px) {
            h1 { font-size: 1.8rem; }
            .description { font-size: 1rem; }
            .install-button { padding: 12px; font-size: 1rem; }
        }
`

function landingTemplate(manifest, config) {
    const logo = manifest.logo || 'https://img.icons8.com/fluency/256/search-in-cloud.png';
    const name = manifest.name || 'Intelligent Debrid Search';
    const version = manifest.version || '0.0.0';
    const description = manifest.description || 'A smarter Stremio add-on to search downloads and torrents in your Debrid cloud.';

    let contactHTML = '';
    if (manifest.contactEmail) {
        contactHTML = '<div class="contact">' +
            '<p>Contact ' + name + ' creator:</p>' +
            '<a href="mailto:' + manifest.contactEmail + '">' + manifest.contactEmail + '</a>' +
        '</div>';
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${name} - Stremio Addon</title>
    <link rel="icon" type="image/png" href="${logo}">
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>${STYLESHEET}</style>
</head>
<body>
    <div class="container">
        <img src="${logo}" alt="${name} Logo" class="logo" />
        <h1>${name}</h1>
        <div class="version">Version ${version}</div>
        <div class="description">${description}</div>

        <div class="api-keys-section">
            <h3><i class="fas fa-key"></i> Get Your Debrid API Key</h3>
            <div class="api-keys-grid">
                <a href="https://real-debrid.com/apitoken" target="_blank" class="api-key-button">
                    <i class="fas fa-external-link-alt"></i> RealDebrid
                </a>
                <a href="https://debrid-link.fr/webapp/apikey" target="_blank" class="api-key-button">
                    <i class="fas fa-external-link-alt"></i> DebridLink
                </a>
                <a href="https://alldebrid.com/apikeys" target="_blank" class="api-key-button">
                    <i class="fas fa-external-link-alt"></i> AllDebrid
                </a>
                <a href="https://www.premiumize.me/account" target="_blank" class="api-key-button">
                    <i class="fas fa-external-link-alt"></i> Premiumize
                </a>
                <a href="https://torbox.app/settings" target="_blank" class="api-key-button">
                    <i class="fas fa-external-link-alt"></i> TorBox
                </a>
            </div>
        </div>

        <div class="config-section">
            <form id="mainForm">
                <div class="config-group">
                    <label class="config-label">
                        <i class="fas fa-server"></i> Debrid Provider
                    </label>
                    <div class="dropdown">
                        <div class="dropdown-btn" id="dropdownButton">
                            <span id="selectedOption">Choose your debrid provider</span>
                            <i class="fas fa-chevron-down chevron"></i>
                        </div>
                        <div class="dropdown-content" id="dropdownContent">
                            <div class="dropdown-item" style="--i:1" data-value="RealDebrid">RealDebrid</div>
                            <div class="dropdown-item" style="--i:2" data-value="DebridLink">DebridLink</div>
                            <div class="dropdown-item" style="--i:3" data-value="AllDebrid">AllDebrid</div>
                            <div class="dropdown-item" style="--i:4" data-value="Premiumize">Premiumize</div>
                            <div class="dropdown-item" style="--i:5" data-value="TorBox">TorBox</div>
                        </div>
                    </div>
                </div>
                <div class="config-group">
                    <label for="DebridApiKey" class="config-label">
                        <i class="fas fa-key"></i> Debrid API Key
                    </label>
                    <div class="api-key-input-container">
                        <input type="password" id="DebridApiKey" name="DebridApiKey" required placeholder="Enter your API key" />
                        <i class="fas fa-eye toggle-password" id="toggleApiKey"></i>
                    </div>
                </div>
                <div class="toggle-group-wrapper">
                    <label for="ShowCatalog" class="toggle-group">
                        <span class="toggle-label-text">
                            <i class="fas fa-list"></i> Show catalog in Stremio
                        </span>
                        <span class="toggle-switch">
                            <input type="checkbox" id="ShowCatalog" name="ShowCatalog" value="true" />
                            <span class="slider"></span>
                        </span>
                    </label>
                </div>
                <div class="config-group">
                    <p style="color: var(--color-text-medium); font-size: 0.9rem; text-align: left; margin-top: 10px;">
                        <i class="fas fa-info-circle"></i> When enabled, shows your cloud torrents in Stremio's Discover section.
                    </p>
                </div>
            </form>
        </div>

        <div class="install-container">
            <button id="mainInstallButton" class="install-button">
                <i class="fas fa-download"></i> Install Addon
            </button>
            <button class="dropdown-toggle" id="dropdownToggle">
                <i class="fas fa-chevron-down"></i>
            </button>
            <div class="dropdown-menu" id="dropdownMenu">
                <a href="#" class="dropdown-item-menu" data-action="install">
                    <i class="fas fa-desktop"></i> Install for Desktop
                </a>
                <a href="#" class="dropdown-item-menu" data-action="web">
                    <i class="fas fa-window-maximize"></i> Install for Web
                </a>
                <a href="#" class="dropdown-item-menu" data-action="copy">
                    <i class="fas fa-copy"></i> Copy Manifest URL
                </a>
            </div>
        </div>

        <div class="footer-badge">
            <a href="https://github.com/NepiRaw/Stremio-IntellDebridSearch" target="_blank" rel="noopener noreferrer">
                <img src="https://img.shields.io/badge/GitHub-24292E?style=for-the-badge&logo=github&logoColor=white" alt="GitHub Repository" />
            </a>
        </div>
        ${contactHTML}
    </div>

    <div class="notification" id="notification">
        <i class="fas fa-check-circle" id="notificationIcon"></i>
        <span id="notificationText">URL copied to clipboard!</span>
    </div>

    <script>
    // --- Begin migrated JS from static HTML ---
    document.addEventListener('DOMContentLoaded', function() {
        const elements = {
            mainInstallButton: document.getElementById('mainInstallButton'),
            dropdownToggle: document.getElementById('dropdownToggle'),
            dropdownMenu: document.getElementById('dropdownMenu'),
            notification: document.getElementById('notification'),
            notificationText: document.getElementById('notificationText'),
            notificationIcon: document.getElementById('notificationIcon'),
            mainForm: document.getElementById('mainForm'),
            debridApiKey: document.getElementById('DebridApiKey'),
            showCatalog: document.getElementById('ShowCatalog'),
            dropdownButton: document.getElementById('dropdownButton'),
            dropdownContent: document.getElementById('dropdownContent'),
            chevron: document.querySelector('.chevron'),
            selectedOption: document.getElementById('selectedOption'),
            toggleApiKey: document.getElementById('toggleApiKey')
        };
        let selectedProvider = "";
        // Toggle API Key visibility
        elements.toggleApiKey.addEventListener('click', function() {
            const type = elements.debridApiKey.getAttribute('type') === 'password' ? 'text' : 'password';
            elements.debridApiKey.setAttribute('type', type);
            this.classList.toggle('fa-eye');
            this.classList.toggle('fa-eye-slash');
        });
        // Custom dropdown functionality for Debrid Provider
        elements.dropdownButton.addEventListener('click', function(e) {
            e.stopPropagation();
            elements.dropdownContent.classList.toggle('open');
            elements.chevron.classList.toggle('rotate');
        });
        document.querySelectorAll('.dropdown-item').forEach(item => {
            item.addEventListener('mouseenter', function() {
                this.style.transition = 'none';
                this.style.background = 'rgba(74, 144, 226, 0.3)';
                this.style.paddingLeft = '25px';
                setTimeout(function() { item.style.transition = ''; }, 10);
            });
            item.addEventListener('mouseleave', function() {
                this.style.transition = 'none';
                this.style.background = '';
                this.style.paddingLeft = '14px';
                setTimeout(function() { item.style.transition = ''; }, 10);
            });
            item.addEventListener('click', function() {
                selectedProvider = this.dataset.value;
                elements.selectedOption.textContent = this.textContent;
                elements.dropdownContent.classList.remove('open');
                elements.chevron.classList.remove('rotate');
                elements.dropdownButton.style.background = 'rgba(74, 144, 226, 0.2)';
                elements.dropdownButton.style.borderColor = 'var(--color-accent-blue)';
                elements.dropdownButton.style.boxShadow = '0 0 15px rgba(74, 144, 226, 0.6)';
                setTimeout(function() {
                    elements.dropdownButton.style.background = 'rgba(74, 144, 226, 0.15)';
                    elements.dropdownButton.style.boxShadow = '0 2px 4px var(--color-shadow)';
                    elements.dropdownButton.style.borderColor = 'var(--color-border-strong)';
                }, 1000);
            });
        });
        document.addEventListener('click', function(e) {
            if (!elements.dropdownButton.contains(e.target) && !elements.dropdownContent.contains(e.target)) {
                elements.dropdownContent.classList.remove('open');
                elements.chevron.classList.remove('rotate');
            }
        });
        elements.dropdownToggle.addEventListener('click', function(e) {
            e.stopPropagation();
            elements.dropdownMenu.classList.toggle('show');
            if (elements.dropdownMenu.classList.contains('show')) {
                setTimeout(function() {
                    var lastItem = elements.dropdownMenu.lastElementChild;
                    if (lastItem) {
                        lastItem.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'end' });
                    }
                }, 10);
            }
        });
        document.querySelectorAll('.dropdown-item-menu').forEach(function(item) {
            item.addEventListener('click', function(e) {
                e.preventDefault();
                handleInstallAction(item.dataset.action);
                elements.dropdownMenu.classList.remove('show');
            });
        });
        elements.mainInstallButton.addEventListener('click', function(e) {
            e.preventDefault();
            handleInstallAction('install');
        });
        document.addEventListener('click', function(e) {
            if (!elements.dropdownMenu.contains(e.target) && !elements.dropdownToggle.contains(e.target) && !elements.mainInstallButton.contains(e.target)) {
                elements.dropdownMenu.classList.remove('show');
            }
        });
        function isValidConfig() {
            return selectedProvider && elements.debridApiKey.value.trim() !== '';
        }
        async function handleInstallAction(action) {
            if (!isValidConfig()) {
                showNotification('Please fill in all required fields', 'warning');
                return;
            }
            
            var config = {
                DebridProvider: selectedProvider,
                DebridApiKey: elements.debridApiKey.value,
                ShowCatalog: elements.showCatalog.checked
            };
            
            try {
                updateButtonState(true, 'Validating & securing...');
                
                const response = await fetch('/encrypt-config', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(config)
                });
                const data = await response.json();
                
                if (data.validationFailed) {
                    showNotification('The debrid API key is invalid.', 'error');
                    elements.debridApiKey.classList.add('error');
                    elements.debridApiKey.classList.remove('success');
                    updateButtonState(false);
                    return;
                }
                
                if (data.error && !data.encrypted) {
                    showNotification(data.error, 'warning');
                    updateButtonState(false);
                    return;
                }
                
                if (data.encrypted && data.desktopUrl && data.webUrl && data.manifestUrl) {
                    showNotification('Configuration validated & secured!', 'success');
                    elements.debridApiKey.classList.remove('error');
                    elements.debridApiKey.classList.add('success');
                    
                    var actions = {
                        install: function() {
                            updateButtonState(true, 'Opening Stremio...');
                            window.location.href = data.desktopUrl;
                            setTimeout(function() { updateButtonState(false); }, 3000);
                        },
                        web: function() {
                            updateButtonState(true, 'Opening Stremio Web...');
                            window.open(data.webUrl, '_blank');
                            setTimeout(function() { updateButtonState(false); }, 1000);
                        },
                        copy: function() {
                            navigator.clipboard.writeText(data.manifestUrl);
                            showNotification('Encrypted manifest URL copied to clipboard!', 'success');
                            updateButtonState(false);
                        }
                    };
                    
                    if (actions[action]) {
                        actions[action]();
                        return;
                    }
                }
            } catch (error) {
                console.warn('Encryption request failed, using fallback:', error);
                showNotification('Using fallback method...', 'info');
            }
            
            var configString = encodeURIComponent(JSON.stringify(config));
            var manifestHost = window.location.host;
            var manifestUrl = 'stremio://' + manifestHost + '/' + configString + '/manifest.json';
            var webUrl = 'https://web.stremio.com/#/addons?addon=' + encodeURIComponent('https://' + manifestHost + '/' + configString + '/manifest.json');
            
            var fallbackActions = {
                install: function() {
                    window.location.href = manifestUrl;
                    setTimeout(function() { updateButtonState(false); }, 3000);
                },
                web: function() {
                    window.open(webUrl, '_blank');
                    updateButtonState(false);
                },
                copy: function() {
                    navigator.clipboard.writeText('https://' + manifestHost + '/' + configString + '/manifest.json');
                    showNotification('Manifest URL copied to clipboard!', 'success');
                    updateButtonState(false);
                }
            };
            
            if (fallbackActions[action]) fallbackActions[action]();
        }
        function updateButtonState(isLoading, text) {
            text = text || 'Opening...';
            if (isLoading) {
                elements.mainInstallButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ' + text;
                elements.mainInstallButton.classList.add('success');
            } else {
                elements.mainInstallButton.innerHTML = '<i class="fas fa-download"></i> Install Addon';
                elements.mainInstallButton.classList.remove('success');
            }
        }
        function showNotification(text, type) {
            // Set icon based on notification type
            var iconClass = 'fa-check-circle'; // default success
            if (type === 'error') {
                iconClass = 'fa-times-circle';
            } else if (type === 'warning') {
                iconClass = 'fa-exclamation-triangle';
            } else if (type === 'info') {
                iconClass = 'fa-info-circle';
            }
            elements.notificationIcon.className = 'fas ' + iconClass;
            elements.notificationText.textContent = text;
            
            // Update notification background color based on type
            elements.notification.classList.remove('notification-success', 'notification-error', 'notification-warning', 'notification-info');
            if (type === 'error') {
                elements.notification.classList.add('notification-error');
            } else if (type === 'warning') {
                elements.notification.classList.add('notification-warning');
            } else if (type === 'info') {
                elements.notification.classList.add('notification-info');
            } else {
                elements.notification.classList.add('notification-success');
            }
            
            elements.notification.classList.add('show');
            setTimeout(function() { elements.notification.classList.remove('show'); }, 3000);
        }
        // Pre-fill config if provided
        if (config && typeof config === 'object') {
            if (config.DebridProvider) {
                selectedProvider = config.DebridProvider;
                elements.selectedOption.textContent = config.DebridProvider;
            }
            if (config.DebridApiKey) {
                elements.debridApiKey.value = config.DebridApiKey;
            }
            if (config.ShowCatalog) {
                elements.showCatalog.checked = true;
            }
        }
    });
    // --- End migrated JS ---
    </script>
</body>

</html>`;
}

export default landingTemplate;
