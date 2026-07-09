/* Collection Section plugin - injected into index.html by the File Transformation plugin. */
(function () {
    'use strict';

    var ITEM_ATTR = 'data-collectionsection-item';
    var CACHE_TTL_MS = 30000;
    var cache = new Map(); // itemId -> { time, promise }
    var observerTimer = null;

    function log() {
        try {
            console.debug.apply(console, ['[CollectionSection]'].concat([].slice.call(arguments)));
        } catch (e) { /* ignore */ }
    }

    function escapeHtml(text) {
        var div = document.createElement('div');
        div.textContent = text == null ? '' : String(text);
        return div.innerHTML;
    }

    function getVisibleDetailPage() {
        var pages = document.querySelectorAll('.itemDetailPage:not(.hide)');
        return pages.length ? pages[pages.length - 1] : null;
    }

    function getItemIdFromUrl() {
        var raw = (window.location.hash || '').replace(/^#!?/, '');
        var queryIndex = raw.indexOf('?');
        var search = queryIndex >= 0
            ? raw.substring(queryIndex + 1)
            : window.location.search.replace(/^\?/, '');

        try {
            return new URLSearchParams(search).get('id');
        } catch (e) {
            return null;
        }
    }

    /**
     * Fetches "collections containing this item" (plus the plugin's client
     * settings) and each collection's children. Kicked off as early as possible
     * (on the navigation event itself) and cached briefly, so the section can
     * render together with the rest of the page.
     */
    function fetchData(itemId) {
        var now = Date.now();
        var entry = cache.get(itemId);
        if (entry && (now - entry.time) < CACHE_TTL_MS) {
            return entry.promise;
        }

        var apiClient = window.ApiClient;
        var userId = apiClient.getCurrentUserId();
        var url = apiClient.getUrl('CollectionSection/Collections', { itemId: itemId });

        var promise = apiClient.getJSON(url).then(function (response) {
            var data = {
                position: response.SectionPosition || response.sectionPosition || 'aboveCast',
                highlight: response.HighlightStyle || response.highlightStyle || 'ring',
                collections: []
            };

            var collections = response.Collections || response.collections || [];
            if (!collections.length) {
                return data;
            }

            return Promise.all(collections.map(function (collection) {
                var collectionId = collection.Id || collection.id;
                return apiClient.getItems(userId, {
                    ParentId: collectionId,
                    Fields: 'PrimaryImageAspectRatio,ProductionYear',
                    ImageTypeLimit: 1,
                    EnableImageTypes: 'Primary'
                }).then(function (result) {
                    return {
                        id: collectionId,
                        name: collection.Name || collection.name,
                        items: (result && result.Items) || []
                    };
                });
            })).then(function (loaded) {
                data.collections = loaded;
                return data;
            });
        });

        promise.catch(function () {
            cache.delete(itemId);
        });

        cache.set(itemId, { time: now, promise: promise });
        if (cache.size > 30) {
            cache.delete(cache.keys().next().value);
        }

        return promise;
    }

    function removeSections(scope) {
        var sections = scope.querySelectorAll('[data-collectionsection]');
        for (var i = 0; i < sections.length; i++) {
            sections[i].parentElement.removeChild(sections[i]);
        }
    }

    function check() {
        var apiClient = window.ApiClient;
        if (!apiClient) {
            return;
        }

        var itemId = getItemIdFromUrl();
        if (!itemId) {
            return;
        }

        // Start (or reuse) the data fetch right away, even if the target page
        // hasn't been shown yet - by the time it appears the data is ready.
        var dataPromise = fetchData(itemId);

        var page = getVisibleDetailPage();
        if (!page || page.getAttribute(ITEM_ATTR) === itemId) {
            return;
        }

        page.setAttribute(ITEM_ATTR, itemId);
        removeSections(page);

        dataPromise.then(function (data) {
            // Bail if the user navigated elsewhere in the meantime.
            if (page.getAttribute(ITEM_ATTR) !== itemId) {
                return;
            }

            removeSections(page);
            for (var i = 0; i < data.collections.length; i++) {
                if (data.collections[i].items.length) {
                    insertSection(page, data.collections[i], itemId, apiClient, data);
                }
            }
        }).catch(function (err) {
            log('failed to render collection section', err);
        });
    }

    /**
     * Native jellyfin-web hover overlay (play, watched, favorite, menu buttons).
     * Same markup jellyfin-web injects on mouseenter; visibility/fade is handled
     * by the web client's own .card:hover CSS.
     */
    function buildHoverOverlay(item, serverId) {
        var userData = item.UserData || {};
        var btnClass = 'cardOverlayButton cardOverlayButton-hover itemAction paper-icon-button-light';
        var iconClass = 'material-icons cardOverlayButtonIcon cardOverlayButtonIcon-hover';
        var itemAttrs = ' data-id="' + item.Id + '" data-serverid="' + serverId + '"'
            + ' data-itemtype="' + (item.Type || 'Movie') + '"';

        var html = '';
        html += '<div class="cardOverlayContainer itemAction" data-action="link">';

        html += '<button is="paper-icon-button-light" type="button" data-action="resume" title="Play"'
            + ' class="' + btnClass + ' cardOverlayFab-primary">'
            + '<span class="' + iconClass + ' play_arrow" aria-hidden="true"></span></button>';

        html += '<div class="cardOverlayButton-br flex">';

        html += '<button is="emby-playstatebutton" type="button" data-action="none"' + itemAttrs
            + ' data-played="' + (userData.Played ? 'true' : 'false') + '"'
            + ' class="' + btnClass + ' emby-button">'
            + '<span class="' + iconClass + ' check playstatebutton-icon-'
            + (userData.Played ? 'played' : 'unplayed') + '" aria-hidden="true"></span></button>';

        html += '<button is="emby-ratingbutton" type="button" data-action="none"' + itemAttrs
            + ' data-likes="" data-isfavorite="' + (userData.IsFavorite ? 'true' : 'false') + '"'
            + ' class="' + btnClass + ' emby-button">'
            + '<span class="' + iconClass + ' favorite'
            + (userData.IsFavorite ? ' ratingbutton-icon-withrating' : '') + '" aria-hidden="true"></span></button>';

        html += '<button is="paper-icon-button-light" type="button" data-action="menu" title="More"'
            + ' class="' + btnClass + '">'
            + '<span class="' + iconClass + ' more_vert" aria-hidden="true"></span></button>';

        html += '</div></div>';
        return html;
    }

    function buildCard(item, index, currentItemId, apiClient) {
        var serverId = item.ServerId || apiClient.serverId();
        var isCurrent = item.Id === currentItemId;
        var itemType = item.Type || 'Movie';
        var isFolder = itemType === 'Series';
        var href = '#/details?id=' + item.Id + '&serverId=' + serverId;
        var name = escapeHtml(item.Name || '');

        var imgUrl = null;
        if (item.ImageTags && item.ImageTags.Primary) {
            var imgOptions = { type: 'Primary', maxWidth: 400, tag: item.ImageTags.Primary };
            imgUrl = typeof apiClient.getScaledImageUrl === 'function'
                ? apiClient.getScaledImageUrl(item.Id, imgOptions)
                : apiClient.getUrl('Items/' + item.Id + '/Images/Primary', { maxWidth: 400, tag: item.ImageTags.Primary, quality: 90 });
        }

        var cardClass = 'card overflowPortraitCard card-hoverable card-withuserdata'
            + (isCurrent ? ' collectionSectionCurrent' : '');

        var html = '';
        html += '<div class="' + cardClass + '" data-index="' + index + '"'
            + ' data-isfolder="' + (isFolder ? 'true' : 'false') + '"'
            + ' data-serverid="' + serverId + '" data-id="' + item.Id + '"'
            + ' data-type="' + itemType + '"'
            + (isFolder ? '' : ' data-mediatype="Video"') + '>';
        html += '<div class="cardBox cardBox-bottompadded">';
        html += '<div class="cardScalable">';
        html += '<div class="cardPadder cardPadder-overflowPortrait"></div>';

        if (imgUrl) {
            html += '<a href="' + href + '" class="cardImageContainer coveredImage cardContent itemAction"'
                + ' data-action="link" aria-label="' + name + '"'
                + ' style="background-image:url(\'' + imgUrl + '\')"></a>';
        } else {
            html += '<a href="' + href + '" class="cardImageContainer coveredImage cardContent itemAction'
                + ' defaultCardBackground defaultCardBackground' + ((index % 4) + 1) + '"'
                + ' data-action="link" aria-label="' + name + '">'
                + '<div class="cardText cardDefaultText">' + name + '</div></a>';
        }

        if (item.UserData && item.UserData.Played) {
            html += '<div class="cardIndicators"><div class="playedIndicator indicator">'
                + '<span class="material-icons indicatorIcon check" aria-hidden="true"></span></div></div>';
        }

        html += buildHoverOverlay(item, serverId);
        html += '</div>';
        html += '<div class="cardText cardTextCentered cardText-first"><bdi>'
            + '<a href="' + href + '" data-id="' + item.Id + '" data-serverid="' + serverId + '"'
            + ' data-type="' + itemType + '"'
            + (isFolder ? ' data-isfolder="true"' : ' data-mediatype="Video" data-isfolder="false"')
            + ' class="itemAction textActionButton" title="' + name + '" data-action="link">' + name + '</a>'
            + '</bdi></div>';
        html += '<div class="cardText cardTextCentered cardText-secondary"><bdi>'
            + (item.ProductionYear ? escapeHtml(item.ProductionYear) : '&nbsp;') + '</bdi></div>';
        html += '</div></div>';
        return html;
    }

    /**
     * Inserts the section at the configured position. Subsequent sections are
     * chained after the previous one so multiple collections keep their order.
     */
    function placeSection(page, content, section, position) {
        var existing = content.querySelectorAll('[data-collectionsection]');
        var last = existing.length ? existing[existing.length - 1] : null;
        if (last) {
            last.parentElement.insertBefore(section, last.nextSibling);
            return;
        }

        var cast = page.querySelector('#castCollapsible') || page.querySelector('.peopleSection');
        if (!cast || !cast.parentElement || position === 'top') {
            content.insertBefore(section, content.firstChild);
        } else if (position === 'belowCast') {
            cast.parentElement.insertBefore(section, cast.nextSibling);
        } else {
            cast.parentElement.insertBefore(section, cast);
        }
    }

    function insertSection(page, collection, currentItemId, apiClient, settings) {
        var content = page.querySelector('.detailPageContent');
        if (!content) {
            log('detailPageContent not found, skipping');
            return;
        }

        var serverId = apiClient.serverId();
        var titleHref = '#/details?id=' + collection.id + '&serverId=' + serverId;

        var section = document.createElement('div');
        section.className = 'verticalSection detailVerticalSection collectionSection';
        section.setAttribute('data-collectionsection', 'true');
        section.setAttribute('data-cs-highlight', settings.highlight || 'ring');

        var html = '';
        html += '<h2 class="sectionTitle sectionTitle-cards padded-right">'
            + '<a href="' + titleHref + '" class="collectionSectionTitleLink">' + escapeHtml(collection.name) + '</a></h2>';
        html += '<div is="emby-scroller" class="padded-top-focusscale padded-bottom-focusscale no-padding"'
            + ' data-mousewheel="false" data-centerfocus="card">';
        html += '<div is="emby-itemscontainer" class="focuscontainer-x itemsContainer scrollSlider">';

        for (var i = 0; i < collection.items.length; i++) {
            html += buildCard(collection.items[i], i, currentItemId, apiClient);
        }

        html += '</div></div>';
        section.innerHTML = html;

        placeSection(page, content, section, settings.position || 'aboveCast');
        applyRingRadius(section);
        scrollCurrentIntoView(section);

        log('inserted section "' + collection.name + '" with ' + collection.items.length + ' items');
    }

    /**
     * Themes put the visible card corner rounding on different elements
     * (e.g. the image itself, or an overflow-clipped wrapper). Measure the
     * effective radius and expose it so the highlight ring matches exactly.
     */
    function applyRingRadius(section) {
        var currentCard = section.querySelector('.collectionSectionCurrent');
        if (!currentCard) {
            return;
        }

        try {
            var scalable = currentCard.querySelector('.cardScalable');
            var image = currentCard.querySelector('.cardImageContainer');
            var radius = Math.max(
                scalable ? parseFloat(getComputedStyle(scalable).borderTopLeftRadius) || 0 : 0,
                image ? parseFloat(getComputedStyle(image).borderTopLeftRadius) || 0 : 0
            );
            if (radius > 0) {
                section.style.setProperty('--cs-ring-radius', radius + 'px');
            }
        } catch (e) { /* keep CSS fallback radius */ }
    }

    /**
     * Long collections can leave the current item off-screen; center it in the
     * scroller (without animation, so the page doesn't visibly jump). The
     * scroller's size measurements are not final right after insertion, so the
     * centering is re-issued a few times - re-runs are no-ops once correct.
     */
    function scrollCurrentIntoView(section) {
        var currentCard = section.querySelector('.collectionSectionCurrent');
        var scroller = section.querySelector('[is="emby-scroller"]');
        if (!currentCard || !scroller) {
            return;
        }

        [0, 300, 800].forEach(function (delay) {
            setTimeout(function () {
                if (!section.isConnected) {
                    return;
                }
                try {
                    if (typeof scroller.toCenter === 'function') {
                        scroller.toCenter(currentCard, true);
                    } else if (typeof scroller.toStart === 'function') {
                        scroller.toStart(currentCard, true);
                    }
                } catch (e) { /* not scrollable yet - ignore */ }
            }, delay);
        });
    }

    // Navigation events run immediately - the fetch must start as early as possible.
    document.addEventListener('viewshow', check, true);
    window.addEventListener('hashchange', check);
    window.addEventListener('popstate', check);

    // The MutationObserver is only a safety net (e.g. initial page load); debounced.
    var observer = new MutationObserver(function () {
        if (observerTimer) {
            clearTimeout(observerTimer);
        }
        observerTimer = setTimeout(check, 100);
    });

    function start() {
        if (!document.body) {
            setTimeout(start, 100);
            return;
        }
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class']
        });
        check();
        log('initialized');
    }

    start();
})();
