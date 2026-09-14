/**
 * Music Controller Module
 */
class MusicApp {
    constructor() {
        this.embedController = null;
        this.defaultUri = 'spotify:track:4cOdK2wGLETKBW3PvgPWqT'; // Default track URI
        this.initUI();
    }

    initUI() {
        const searchBtn = document.getElementById('search-btn');
        const searchInput = document.getElementById('track-search');

        searchBtn.addEventListener('click', () => {
            const query = searchInput.value.trim();
            if (query) {
                this.loadTrack(query);
            }
        });
    }

    setController(EmbedController) {
        this.embedController = EmbedController;
    }

    loadTrack(uri) {
        if (this.embedController) {
            // Converts standard track links to URIs if needed
            const formattedUri = uri.includes('spotify.com/track/')
                ? `spotify:track:${uri.split('track/')[1].split('?')[0]}`
                : uri;

            this.embedController.loadUri(formattedUri);
        }
    }
}

const app = new MusicApp();

// Spotify IFrame API Callback
window.onSpotifyIframeApiReady = (IFrameAPI) => {
    const element = document.getElementById('embed-iframe');
    const options = {
        width: '100%',
        height: '152',
        uri: app.defaultUri
    };

    const callback = (EmbedController) => {
        app.setController(EmbedController);
    };

    IFrameAPI.createController(element, options, callback);
};

