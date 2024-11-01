// src/utils/similarity.ts

/**
 * Computes string similarity using Dice's coefficient
 * @param str1 First string to compare
 * @param str2 Second string to compare
 * @returns Number between 0 and 1, where 1 means identical strings
 */
export function computeStringSimilarity(str1: string, str2: string): number {
    const normalize = (str: string) => str.toLowerCase().trim();
    const s1 = normalize(str1);
    const s2 = normalize(str2);

    if (s1 === s2) return 1;
    if (s1.length === 0 || s2.length === 0) return 0;

    const pairs1 = getPairs(s1);
    const pairs2 = getPairs(s2);
    
    // Calculate intersection size directly without storing union
    const intersectionSize = [...pairs1].filter(x => pairs2.has(x)).length;
    
    return (2.0 * intersectionSize) / (pairs1.size + pairs2.size);
}

/**
 * Creates character pairs from a string
 * @param str Input string
 * @returns Set of character pairs
 */
function getPairs(str: string): Set<string> {
    const pairs = new Set<string>();
    for (let i = 0; i < str.length - 1; i++) {
        pairs.add(str.slice(i, i + 2));
    }
    return pairs;
}