/*
    Copyright (c) 2022 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import "./base/livereload";
declare const ENABLE_REPO_SUPPORT: boolean;
if (ENABLE_REPO_SUPPORT) {
    import("./kicanvas/elements/kicanvas-shell");
}
import "./kicanvas/elements/kicanvas-embed";
