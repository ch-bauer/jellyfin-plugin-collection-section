# Jellyfin Collection Row Plugin

Adds a section to the **movie detail page** that shows the collection the movie belongs to:
the section is titled with the collection's name and lists **all movies of the collection as
native Jellyfin movie cards** — clickable, scrollable with arrows, with the full native hover
overlay (play, watched, favorite, menu), in the collection's display order. The movie you are
currently viewing is highlighted and automatically scrolled into view.

If a movie is in several collections, one section per collection is shown.

![Collection section](images/1.PNG)
![Collection section with rounded theme](images/2.PNG)

## Configuration (Dashboard → Plugins → Collection Row)

- **Section position**: above Cast & Crew (default), below Cast & Crew, or at the top of the details.
- **Highlight of the current item**: frame around the poster (default), dim the other items, or none.
- **Series support**: optionally show the section on series detail pages too.
- **Per-collection toggle**: untick collections (searchable list) that should not show a section.

The visuals adapt to the active CSS theme automatically (corner rounding is measured at runtime,
colors follow the theme's accent/text color).

## Requirements

- Jellyfin **10.11.x**
- [File Transformation plugin](https://github.com/IAmParadox27/jellyfin-plugin-file-transformation)
  2.5.x or newer — install it from the repository `https://www.iamparadox.dev/jellyfin/plugins/manifest.json`
  (Dashboard → Plugins → Repositories), then restart Jellyfin.

## Install from plugin repository (recommended)

1. Dashboard → Plugins → Repositories → add
   `https://raw.githubusercontent.com/ch-bauer/jellyfin-plugin-collection-row/main/manifest.json`
2. Install **Collection Row** from the catalog and restart Jellyfin.
3. Hard-refresh the browser (Ctrl+F5) once after install/update.

## Manual install

1. Build: `dotnet build -c Release` (or download the zip from the GitHub releases).
2. Copy the folder `dist/CollectionRow_<version>/` (containing the DLL and `meta.json`)
   into your Jellyfin `plugins` directory
   (e.g. `/var/lib/jellyfin/plugins`, `/config/plugins` in Docker,
   `C:\ProgramData\Jellyfin\Server\plugins` on Windows).
3. Restart Jellyfin, then hard-refresh the browser (Ctrl+F5).

## How it works

- A startup task registers a transformation for `index.html` with the File Transformation plugin
  (via reflection, the documented integration path). The transformation inlines this plugin's
  JS/CSS into the page head — jellyfin-web itself is never modified on disk.
- The injected script watches for the item detail view, asks the plugin's API
  (`GET /CollectionSection/Collections?itemId=…`) which collections contain the item (a reverse
  lookup Jellyfin's public API doesn't offer), fetches the collection children through the
  standard items API (so display order, permissions, and user data are respected), and renders
  them using Jellyfin's own card markup and `emby-scroller` / `emby-itemscontainer` elements —
  so the section looks and behaves exactly like the built-in "More Like This" row. Data is
  prefetched on navigation and briefly cached, so the section renders together with the page.
