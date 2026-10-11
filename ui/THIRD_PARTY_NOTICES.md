# Third-party animation attribution

The animation system in this browser prototype adapts techniques from:

Codenotch by Vinz
https://github.com/vinzdg/codenotch

Relevant source files:
- Sources/Notch/NotchMotion.swift: shared motion timing, spring response and damping
- windows/codenotch/ui/carry.html: two-half-step damped spring
- windows/codenotch/ui/notch.html: press response and SVG gooey filters
- Sources/Features/MoveHandle.swift: liquid-merging concept

The code here is an adaptation to the existing V-Notch prototype, not an exact copy of Codenotch's SwiftUI shape renderer. Its original MIT licence is reproduced below.

MIT License

Copyright (c) 2026 Vinz

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Lucide Icons

Icons sourced from https://github.com/lucide-icons/lucide and used in the browser prototype `lucide-icons.js`. The original Lucide ISC notice, plus the additional Feather-derived MIT notice, are retained in `LICENSE-LUCIDE.txt`. The Piggy Bank PNG is a pre-existing project asset and is not part of the Lucide library.
