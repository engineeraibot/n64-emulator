(function (globalScope) {
    function expand5To8(v) {
        const x = v & 0x1F;
        return (x << 3) | (x >> 2);
    }

    function decodeRgba5551(v) {
        return {
            r: expand5To8((v >> 11) & 0x1F),
            g: expand5To8((v >> 6) & 0x1F),
            b: expand5To8((v >> 1) & 0x1F),
            a: (v & 1) ? 255 : 0
        };
    }

    function shouldRenderVideoFrame(args) {
        const origin = args.origin >>> 0;
        const width = args.width | 0;
        const type = args.type | 0;
        const rspTaskCount = args.rspTaskCount | 0;
        const rdpCommandCount = args.rdpCommandCount | 0;

        if (width <= 0 || type < 2) return false;

        // During boot, some ROMs leave VI origin at 0x280 while no valid graphics work has run.
        // Rendering that region usually produces instruction-memory noise, not a real frame.
        if (origin <= 0x1000 && (rspTaskCount <= 0 || rdpCommandCount <= 0)) return false;

        return true;
    }

    const api = {
        decodeRgba5551,
        shouldRenderVideoFrame
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    globalScope.N64VideoUtils = api;
})(typeof window !== 'undefined' ? window : globalThis);
