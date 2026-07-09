using Jellyfin.Plugin.CollectionSection.Configuration;
using Jellyfin.Plugin.CollectionSection.Model;
using Jellyfin.Plugin.CollectionSection.Services;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.CollectionSection.Controllers
{
    [ApiController]
    [Route("CollectionSection")]
    public class CollectionSectionController : ControllerBase
    {
        private readonly ILibraryManager m_libraryManager;
        private readonly CollectionLookupService m_lookupService;

        public CollectionSectionController(ILibraryManager libraryManager, CollectionLookupService lookupService)
        {
            m_libraryManager = libraryManager;
            m_lookupService = lookupService;
        }

        /// <summary>
        /// Returns the collections (BoxSets) that contain the given item plus the
        /// client-relevant plugin settings, excluding collections disabled in the
        /// plugin configuration.
        /// </summary>
        [HttpGet("Collections")]
        [Authorize]
        public ActionResult<CollectionsResponse> GetCollections([FromQuery] Guid itemId)
        {
            if (itemId == Guid.Empty)
            {
                return BadRequest("itemId is required.");
            }

            PluginConfiguration config = Plugin.Instance?.Configuration ?? new PluginConfiguration();

            BaseItem? item = m_libraryManager.GetItemById(itemId);
            bool supported = item is Movie || (config.IncludeSeries && item is Series);
            if (!supported)
            {
                return Ok(new CollectionsResponse(
                    config.SectionPosition, config.HighlightStyle, Array.Empty<CollectionInfo>()));
            }

            HashSet<Guid> disabled = config.DisabledCollectionIds
                .Select(s => Guid.TryParse(s, out Guid g) ? g : Guid.Empty)
                .Where(g => g != Guid.Empty)
                .ToHashSet();

            IReadOnlyList<CollectionInfo> collections = m_lookupService.GetCollectionsForItem(itemId, disabled);

            return Ok(new CollectionsResponse(config.SectionPosition, config.HighlightStyle, collections));
        }
    }
}
