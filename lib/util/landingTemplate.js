const STYLESHEET = `
* {
	box-sizing: border-box;
}

body,
html {
	margin: 0;
	padding: 0;
	width: 100%;
	min-height: 100%;
}

html {
	background-size: auto 100%;
	background-size: cover;
	background-position: center center;
	background-repeat: repeat-y;
}

body {
    display: flex;
    background: linear-gradient(135deg, #2b1055 0%, #7597de 100%);
    min-height: 100vh;
    font-family: 'Open Sans', Arial, sans-serif;
    color: #f5f5f5;
    letter-spacing: 0.02em;
}

#addon {
   width: 90vh;
   margin: 4vh auto;
   padding: 4vh 10%;
   background: rgba(20, 20, 40, 0.82);
   border-radius: 2vh;
   box-shadow: 0 2vh 4vh rgba(0,0,0,0.25);
   position: relative;
   overflow: hidden;
}

.logo {
    height: 14vh;
    width: 14vh;
    margin: auto;
    margin-bottom: 3vh;
    border-radius: 50%;
    box-shadow: 0 0 2vh #fff3, 0 0 0.5vh #8A5AAB;
    background: rgba(255,255,255,0.05);
    display: flex;
    align-items: center;
    justify-content: center;
}

h1.name {
    font-size: 5vh;
    font-weight: 800;
    background: linear-gradient(90deg, #8A5AAB 30%, #7597de 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    margin-bottom: 1vh;
}

h2.version {
    font-size: 2vh;
    color: #bdbdbd;
    margin-bottom: 2vh;
}

h2.description {
    font-size: 2.2vh;
    color: #e0e0e0;
    margin-bottom: 2vh;
}

.smart-explain {
    background: rgba(138,90,171,0.12);
    border-left: 0.7vh solid #8A5AAB;
    border-radius: 1vh;
    padding: 1.5vh 2vh;
    margin-bottom: 2vh;
    font-size: 1.7vh;
    color: #e6e6fa;
    box-shadow: 0 0.5vh 1vh rgba(138,90,171,0.08);
}

input, select {
    background: #23234a;
    color: #fff;
    border: 1px solid #8A5AAB;
    border-radius: 0.7vh;
    padding: 1vh 1.5vh;
    font-size: 2vh;
    margin-top: 0.5vh;
    margin-bottom: 1vh;
    width: 100%;
    outline: none;
    transition: border 0.2s;
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
    box-shadow: 0 0.2vh 0.5vh #0002;
}
select {
    background: #23234a url('data:image/svg+xml;utf8,<svg fill="white" height="16" viewBox="0 0 24 24" width="16" xmlns="http://www.w3.org/2000/svg"><path d="M7 10l5 5 5-5z"/></svg>') no-repeat right 1.5vh center/2vh 2vh;
    color:rgb(186, 150, 253);
    cursor: pointer;
    border: 1px solid #8A5AAB;
    transition: background 0.2s, color 0.2s;
}
select option {
    background: #23234a;
    color: #8A5AAB;
}
select:focus, select:hover {
    background-color: #2b1055;
    color: #e0cfff;
}

.form-element {
    margin-bottom: 2vh;
    display: flex;
    align-items: center;
}

.label-to-top {
    margin-bottom: 1vh;
    width: 30%;
    min-width: 120px;
}

.label-to-right {
    margin-left: 1vh !important;
}

.full-width {
    width: 100%;
}

.show-catalog-label {
    display: flex;
    align-items: center;
    gap: 0.7vh;
    font-size: 2.2vh;
    font-weight: 600;
    padding: 0;
    line-height: inherit;
    margin: 0;
}

.show-catalog-checkbox {
    margin-left: 1.2vh;
    margin-right: 0.5vh;
    width: 2vh;
    height: 2vh;
    accent-color: #8A5AAB;
    appearance: none;
    -webkit-appearance: none;
    background: #23234a;
    border: 2px solid #8A5AAB;
    border-radius: 0.5vh;
    display: inline-block;
    position: relative;
    cursor: pointer;
    transition: border 0.2s, box-shadow 0.2s;
    vertical-align: middle;
}
.show-catalog-checkbox:checked {
    background: linear-gradient(90deg, #8A5AAB 60%, #7597de 100%);
    border-color: #7597de;
}
.show-catalog-checkbox:checked::after {
    content: '\u2713';
    color: #fff;
    font-size: 1.7vh;
    position: absolute;
    left: 0.25vh;
    top: -0.1vh;
    font-weight: bold;
}
.show-catalog-checkbox:focus {
    outline: 2px solid #7597de;
}

.catalog-tooltip {
    display: inline-block;
    position: relative;
    cursor: pointer;
    color: #8A5AAB;
    font-size: 2vh;
    margin-left: 0.5vh;
}
.catalog-tooltip .tooltiptext {
    visibility: hidden;
    width: 28vh;
    background: #23234a;
    color: #fff;
    text-align: left;
    border-radius: 0.7vh;
    padding: 1vh 1.5vh;
    position: absolute;
    z-index: 1;
    bottom: 120%;
    left: 50%;
    margin-left: -14vh;
    opacity: 0;
    transition: opacity 0.2s;
    font-size: 1.7vh;
    box-shadow: 0 0.5vh 1vh #0003;
}
.catalog-tooltip:hover .tooltiptext {
    visibility: visible;
    opacity: 1;
}

button {
    border: 0;
    outline: 0;
    color: white;
    background: linear-gradient(90deg, #8A5AAB 60%, #7597de 100%);
    padding: 1.2vh 3.5vh;
    margin: 2vh auto 0 auto;
    text-align: center;
    font-family: 'Open Sans', Arial, sans-serif;
    font-size: 2.4vh;
    font-weight: 700;
    cursor: pointer;
    display: inline-block;
    box-shadow: 0 0.5vh 1vh rgba(0, 0, 0, 0.2);
    border-radius: 1vh;
    letter-spacing: 0.05em;
    transition: box-shadow 0.1s, background 0.2s, transform 0.1s;
    min-width: 18vh;
}
button:hover {
    background: linear-gradient(90deg, #7597de 0%, #8A5AAB 100%);
    box-shadow: 0 0.2vh 0.5vh #8A5AAB55;
    transform: translateY(-1px) scale(1.03);
}

#addon {
   width: 90vh;
   margin: 4vh auto;
   padding: 4vh 10%;
   background: rgba(20, 20, 40, 0.82);
   border-radius: 2vh;
   box-shadow: 0 2vh 4vh rgba(0,0,0,0.25);
   position: relative;
   overflow: hidden;
}

.logo {
	height: 14vh;
	width: 14vh;
	margin: auto;
	margin-bottom: 3vh;
}

.logo img {
	width: 100%;
}

.name, .version {
	display: inline-block;
	vertical-align: top;
}

.name {
	line-height: 5vh;
	margin: 0;
}

.version {
	position: relative;
	line-height: 5vh;
	opacity: 0.8;
	margin-bottom: 2vh;
}

.contact {
	position: absolute;
	left: 0;
	bottom: 4vh;
	width: 100%;
	text-align: center;
}

.contact a {
	font-size: 1.4vh;
	font-style: italic;
}

.separator {
	margin-bottom: 3vh;
}

.label {
  font-size: 2.2vh;
  font-weight: 600;
  padding: 0;
  line-height: inherit;
}

.form-element {
	margin-bottom: 2vh;
}

.label-to-top {
	margin-bottom: 1vh;
}

.label-to-right {
	margin-left: 1vh !important;
}

.full-width {
	width: 100%;
}

.form-grid {
    display: grid;
    grid-template-columns: 1fr 2fr;
    gap: 1.2vh 2vh;
    align-items: center;
    margin-bottom: 2vh;
}
.form-grid .full-width {
    width: 100%;
}
.form-grid .show-catalog-row {
    grid-column: 1 / span 2;
    display: flex;
    align-items: center;
    gap: 1.2vh;
    margin-top: 0.5vh;
    margin-bottom: 1vh;
}

/* Add tooltip CSS for API key info */
.api-tooltip {
    display: inline-block;
    position: relative;
    cursor: pointer;
    color: #8A5AAB;
    font-size: 1.7vh;
    margin-left: 0.7vh;
}
.api-tooltip .tooltiptext {
    visibility: hidden;
    background: #23234a;
    color: #fff;
    text-align: left;
    border-radius: 0.7vh;
    padding: 1vh 1.5vh;
    position: absolute;
    z-index: 2;
    bottom: 120%;
    opacity: 0;
    transition: opacity 0.2s;
    font-size: 1.7vh;
    box-shadow: 0 0.5vh 1vh #0003;
}
.api-tooltip:hover .tooltiptext {
    visibility: visible;
    opacity: 1;
}

`

function landingTemplate(manifest, config) {
    const background = manifest.background || 'https://dl.strem.io/addon-background.jpg'
    const logo = manifest.logo || 'https://dl.strem.io/addon-logo.png'
    const contactHTML = manifest.contactEmail ?
        `<div class="contact">
			<p>Contact ${manifest.name} creator:</p>
			<a href="mailto:${manifest.contactEmail}">${manifest.contactEmail}</a>
		</div>` : ''

    let formHTML = ''
    let script = ''

    formHTML = `
    <form class="pure-form" id="mainForm">
    <div class="form-grid">
        <label class="label-to-top" for="DebridProvider">Debrid Provider</label>
        <select id="DebridProvider" name="DebridProvider" class="full-width">
            <option value="" disabled selected>Choose your debrid provider</option>
            <option value="RealDebrid">RealDebrid</option>
            <option value="DebridLink">DebridLink</option>
            <option value="AllDebrid">AllDebrid</option>
            <option value="Premiumize">Premiumize</option>
            <option value="TorBox">TorBox</option>
        </select>
        <label class="label-to-top" for="DebridApiKey">Debrid API Key</label>
        <input type="text" id="DebridApiKey" name="DebridApiKey" class="full-width" required>
        <label class="label-to-top" for="TraktApiKey">Trakt API Key <span style='color:#bdbdbd;font-size:1.5vh;'>(optional)
            <span class="api-tooltip">?
                <span class="tooltiptext" style="width:32vh;left:50%;margin-left:-16vh;">
                    <b>Why add Trakt or TMDb API keys?</b><br>
                    <ul style='margin-top:0.5vh;'>
                        <li><b>TMDb API Key</b> enables advanced title and episode matching, especially for non-English or alternate titles, and improves accuracy for obscure or international content.</li>
                        <li><b>Trakt API Key</b> allows the addon to match absolute episode numbers (for anime, specials, or shows with non-standard numbering), ensuring you get the correct episode even for complex series.</li>
                        <li>Both are <b>optional</b> – the addon works without them, but adding them gives you the best search and matching experience!</li>
                    </ul>
                </span>
            </span>
        </span></label>
        <input type="text" id="TraktApiKey" name="TraktApiKey" class="full-width" placeholder="Optional">
        <label class="label-to-top" for="TmdbApiKey">TMDb API Key <span style='color:#bdbdbd;font-size:1.5vh;'>(optional)
            <span class="api-tooltip">?
                <span class="tooltiptext" style="width:32vh;left:50%;margin-left:-16vh;">
                    <b>Why add Trakt or TMDb API keys?</b><br>
                    <ul style='margin-top:0.5vh;'>
                        <li><b>TMDb API Key</b> enables advanced title and episode matching, especially for non-English or alternate titles, and improves accuracy for obscure or international content.</li>
                        <li><b>Trakt API Key</b> allows the addon to match absolute episode numbers (for anime, specials, or shows with non-standard numbering), ensuring you get the correct episode even for complex series.</li>
                        <li>Both are <b>optional</b> – the addon works without them, but adding them gives you the best search and matching experience!</li>
                    </ul>
                </span>
            </span>
        </span></label>
        <input type="text" id="TmdbApiKey" name="TmdbApiKey" class="full-width" placeholder="Optional">
        <div class="show-catalog-row" style="display:flex;align-items:center;gap:1.2vh;">
            <input class="show-catalog-checkbox" type="checkbox" id="ShowCatalog" name="ShowCatalog" value="true" style="margin:0 1.2vh 0 0;position:relative;top:0.1vh;" />
            <label class="show-catalog-label" for="ShowCatalog" style="margin:0;">
                Show catalog
                <span class="catalog-tooltip">?
                    <span class="tooltiptext">If enabled, the addon will show a catalog of all your cloud torrents in Stremio's Discover section. If disabled, only direct search and streaming will be available.</span>
                </span>
            </label>
        </div>
    </div>
    </form>
    <div style="text-align:center;margin-top:2vh;">
        <a id="installLink" class="install-link" href="#">
            <button type="button" name="Install">INSTALL</button>
        </a>
    </div>
    <div class="separator"></div>
`

	script += `
	console.log("${config.Catalog}")
	$('#DebridProvider option[value="${config.DebridProvider}"]').attr("selected", "selected");
	$('#DebridApiKey').val("${config.DebridApiKey || ''}");
	$('#TraktApiKey').val("${config.TraktApiKey || ''}");
	$('#TmdbApiKey').val("${config.TmdbApiKey || ''}");
	$('#ShowCatalog').prop('checked', ${config.ShowCatalog || false});

	installLink.onclick = (e) => {
        if (!mainForm.reportValidity()) {
            e.preventDefault();
            return false;
        }
        // Let the link open stremio://, do not submit or reset the form
        return true;
    };

	const isValidConfig = (config) => {
	    return config.DebridProvider && config.DebridApiKey
	}

	const updateLink = () => {
	    const config = Object.fromEntries(new FormData(mainForm))
	    if (isValidConfig(config)) {
	        installLink.href = 'stremio://' + window.location.host + '/' + encodeURIComponent(JSON.stringify(config)) + '/manifest.json'
	    } else {
	        installLink.href = '#'
	    }
	}
	mainForm.onchange = updateLink;
    updateLink();
    `

    return `
	<!DOCTYPE html>
	<html style="background: linear-gradient(135deg, #2b1055 0%, #7597de 100%); background-attachment: fixed;">

	<head>
		<meta charset="utf-8">
		<title>${manifest.name} - Stremio Addon</title>
		<style>${STYLESHEET}</style>
		<link rel="shortcut icon" href="${logo}" type="image/x-icon">
		<link href="https://fonts.googleapis.com/css?family=Open+Sans:400,600,700&display=swap" rel="stylesheet">
      	<script src="https://code.jquery.com/jquery-3.7.1.slim.min.js"></script>
		<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/purecss@2.1.0/build/pure-min.css" crossorigin="anonymous">
	</head>

	<body>
		<div id="addon">
			<div class="logo">
			    <img src="${logo}" style="border-radius:50%;box-shadow:0 0 2vh #fff3;max-width:100%;max-height:100%;background:#fff1;">
			</div>
			<h1 class="name">${manifest.name}</h1>
			<h2 class="version">v${manifest.version || '0.0.0'}</h2>
			<h2 class="description">${manifest.description || ''}</h2>

            <div class="separator"></div>
            <p>Report any issues on <a href="https://github.com/MrMonkey42/stremio-addon-debrid-search/issues" target="_blank">Github</a></p>
            <div class="separator"></div>
            <div class="smart-explain" style="margin-bottom:2vh;">
                <b>Get the API Key here:</b>
                <ul style="margin-top:0.5vh;">
                    <li><a href="https://real-debrid.com/apitoken" target="_blank">RealDebrid API Key</a></li>
                    <li><a href="https://debrid-link.fr/webapp/apikey" target="_blank">DebridLink API Key</a></li>
                    <li><a href="https://alldebrid.com/apikeys" target="_blank">AllDebrid API Key</a></li>
                    <li><a href="https://www.premiumize.me/account" target="_blank">Premiumize API Key</a></li>
                    <li><a href="https://torbox.app/settings" target="_blank">TorBox API Key</a></li>
                    <li><a href="https://trakt.tv/oauth/applications" target="_blank">Trakt API Key</a></li>
                    <li><a href="https://developer.themoviedb.org/docs/authentication" target="_blank">TMDb API Key</a></li>
                </ul>
            </div>
            <div class="separator"></div>

			${formHTML}

			${contactHTML}
		</div>
        <script>
            ${script}

            if (typeof updateLink === 'function')
                updateLink()
            else
                installLink.href = 'stremio://' + window.location.host + '/manifest.json'
        </script>
    </body>

    </html>`
}

export default landingTemplate
