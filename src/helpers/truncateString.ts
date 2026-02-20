export const truncateString = (text: string, len: number = 10) => {
    if (!text) return "";
    if (text.length <= len) return text;
    return text.slice(0, len) + "...";
}