namespace Jellyfin.Plugin.CollectionSection.Model
{
    public record CollectionInfo(Guid Id, string Name);

    public record CollectionsResponse(string SectionPosition, string HighlightStyle, IReadOnlyList<CollectionInfo> Collections);
}
