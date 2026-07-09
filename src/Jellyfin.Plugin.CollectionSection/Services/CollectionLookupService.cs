using Jellyfin.Data.Enums;
using Jellyfin.Plugin.CollectionSection.Model;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Library;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.CollectionSection.Services
{
    /// <summary>
    /// Answers "which collections contain this item" from an in-memory map.
    /// Enumerating all BoxSets and resolving their linked children takes
    /// hundreds of milliseconds on large libraries, so it is done once, kept
    /// cached, and refreshed in the background when a collection changes or
    /// the cache ages out - requests are never blocked by a rebuild (except
    /// the very first one, which the startup warm-up normally covers).
    /// </summary>
    public sealed class CollectionLookupService : IDisposable
    {
        private static readonly TimeSpan s_cacheTtl = TimeSpan.FromMinutes(10);

        private readonly ILibraryManager m_libraryManager;
        private readonly ILogger<CollectionLookupService> m_logger;
        private volatile List<CachedCollection>? m_cache;
        private DateTime m_builtAt = DateTime.MinValue;
        private int m_rebuilding;

        private sealed record CachedCollection(Guid Id, string Name, string SortName, HashSet<Guid> Children);

        public CollectionLookupService(ILibraryManager libraryManager, ILogger<CollectionLookupService> logger)
        {
            m_libraryManager = libraryManager;
            m_logger = logger;
            m_libraryManager.ItemAdded += OnItemChanged;
            m_libraryManager.ItemUpdated += OnItemChanged;
            m_libraryManager.ItemRemoved += OnItemChanged;
        }

        public void Dispose()
        {
            m_libraryManager.ItemAdded -= OnItemChanged;
            m_libraryManager.ItemUpdated -= OnItemChanged;
            m_libraryManager.ItemRemoved -= OnItemChanged;
        }

        public IReadOnlyList<CollectionInfo> GetCollectionsForItem(Guid itemId, ISet<Guid> disabledCollectionIds)
        {
            List<CachedCollection> cache = EnsureCache();
            return cache
                .Where(c => !disabledCollectionIds.Contains(c.Id) && c.Children.Contains(itemId))
                .OrderBy(c => c.SortName, StringComparer.OrdinalIgnoreCase)
                .Select(c => new CollectionInfo(c.Id, c.Name))
                .ToList();
        }

        /// <summary>Builds the cache ahead of the first request (called at startup).</summary>
        public void Warm()
        {
            try
            {
                EnsureCache();
            }
            catch (Exception ex)
            {
                m_logger.LogWarning(ex, "Failed to warm the collection lookup cache.");
            }
        }

        private void OnItemChanged(object? sender, ItemChangeEventArgs e)
        {
            if (e.Item is BoxSet)
            {
                TriggerBackgroundRebuild();
            }
        }

        private List<CachedCollection> EnsureCache()
        {
            List<CachedCollection>? cache = m_cache;
            if (cache == null)
            {
                return Rebuild();
            }

            if (DateTime.UtcNow - m_builtAt > s_cacheTtl)
            {
                TriggerBackgroundRebuild();
            }

            return cache;
        }

        private void TriggerBackgroundRebuild()
        {
            if (Interlocked.CompareExchange(ref m_rebuilding, 1, 0) != 0)
            {
                return;
            }

            Task.Run(() =>
            {
                try
                {
                    Rebuild();
                }
                catch (Exception ex)
                {
                    m_logger.LogWarning(ex, "Failed to rebuild the collection lookup cache.");
                }
                finally
                {
                    Interlocked.Exchange(ref m_rebuilding, 0);
                }
            });
        }

        private List<CachedCollection> Rebuild()
        {
            List<CachedCollection> built = m_libraryManager.GetItemList(new InternalItemsQuery
                {
                    IncludeItemTypes = new[] { BaseItemKind.BoxSet },
                    CollapseBoxSetItems = false,
                    Recursive = true
                })
                .OfType<BoxSet>()
                .Select(boxSet => new CachedCollection(
                    boxSet.Id,
                    boxSet.Name,
                    boxSet.SortName,
                    boxSet.GetLinkedChildren().Select(child => child.Id).ToHashSet()))
                .ToList();

            m_cache = built;
            m_builtAt = DateTime.UtcNow;
            m_logger.LogDebug("Collection lookup cache rebuilt with {Count} collections.", built.Count);
            return built;
        }
    }
}
