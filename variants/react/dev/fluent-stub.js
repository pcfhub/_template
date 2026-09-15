/*
 * Stand-ins for the Fluent components a virtual control's bundle expects to
 * find on the page.
 *
 * ---
 *
 * **Why a stand-in rather than the real thing.**
 *
 * `pcf-scripts` compiles `import { Popover } from '@fluentui/react-components'`
 * down to a reference on a version-encoded global — `FluentUIReactv940.Popover`
 * — because the manifest declares Fluent as a `<platform-library>` and the host
 * supplies it at runtime. On a form that global is the real Fluent. On a plain
 * page it is nothing at all, and there is no file to put in a `<script src>`:
 * **`@fluentui/react-components` ships no UMD build.** Adding a bundler to
 * produce one would make the harness the thing that needs building.
 *
 * So the page defines the global itself, from this file. Eighty lines of
 * stand-in buys a surface that can be clicked, keyboard-driven, screenshotted
 * and switched between host states — none of which `npm start` offers, and none
 * of which `npm run smoke` can show you.
 *
 * ---
 *
 * **What it is not, and this list is the price of admission.** A stub that
 * quietly does *more* than the thing it stands in for certifies a control that
 * does not work. These all do less, which is the safe direction — but you have
 * to know which:
 *
 *   - **Nothing is portalled.** The real `PopoverSurface` mounts near the end
 *     of `document.body`; here it is a descendant of the control's own root.
 *     A stylesheet rule scoped through the control's root therefore works on
 *     this page and matches nothing on a form. Lead popover rules with their
 *     own class, and confirm in `npm start`.
 *   - **No focus trap and no Escape.** Fluent's `trapFocus` brings both; this
 *     brings neither, so tab order inside a surface is the document's own.
 *   - **`FluentProvider` publishes no design tokens unless the theme carries
 *     them**, which is deliberate: it exercises the literal fallbacks in the
 *     stylesheet — the branch a canvas app and PCFHub's demo harness actually
 *     get. `webDarkTheme` below carries a small set to exercise the other.
 *
 *   - **`Menu` closes only on a choice.** The real one also closes on an
 *     outside click and on Escape; this one stays open until an item is
 *     picked or the trigger pressed again, so a screenshot can show it.
 *   - **`Button` is a `<button>`** with its appearance as a class and no
 *     icon slot; `disableButtonEnhancement` is swallowed.
 *
 * ---
 *
 * **Adding a component.** Stub the ones your control imports and no more. A
 * plain wrapper is usually enough; the non-obvious case is a *compound*
 * component, where Fluent's parts talk to each other through React context.
 * `Popover` below is the worked example: each part carries a
 * `__harnessRole` marker and the parent reads its own children for them, which
 * is enough because the parent is the only thing that renders them.
 *
 * The scaffolded control imports little or none of this. It is here so that the
 * first Fluent import does not also cost you a browser rig.
 */

(function (global) {
    'use strict';

    var React = global.__harnessReact;

    if (!React) {
        throw new Error('fluent-stub.js needs window.__harnessReact set to the React UMD build.');
    }

    /**
     * Fluent's web *dark* values for the tokens a control is most likely to
     * name, as CSS custom properties.
     *
     * Not a theme — a theme is several hundred tokens and reproducing one here
     * would be maintaining a copy of Fluent. The point is to prove the `var()`
     * side of every declaration resolves against *something*, and that the
     * light literal beside it is reachable when it does not. Add the tokens
     * your stylesheet actually names; anything missing falls back, which is
     * exactly what a partial host theme does.
     */
    var DARK_TOKENS = {
        colorNeutralBackground1: '#292929',
        colorNeutralBackground1Hover: '#383838',
        colorNeutralBackground2: '#1f1f1f',
        colorNeutralBackground3: '#141414',
        colorNeutralBackground5: '#000000',
        colorNeutralForeground3: '#adadad',
        colorBrandBackground: '#115ea3',
        colorBrandBackground2: '#082338',
        colorBrandStroke1: '#479ef5',
        colorStrokeFocus2: '#ffffff',
        colorPaletteRedForeground1: '#e37d80',
        colorPaletteRedBackground1: '#3f1011',
        colorNeutralForeground1: '#ffffff',
        colorNeutralForeground2: '#d6d6d6',
        colorNeutralForeground4: '#999999',
        colorNeutralForegroundDisabled: '#5c5c5c',
        colorNeutralForegroundOnBrand: '#ffffff',
        colorNeutralStroke1: '#666666',
        colorNeutralStroke2: '#404040',
        colorNeutralStrokeDisabled: '#424242',
        colorTransparentStroke: 'transparent',
        colorTransparentBackground: 'transparent',
        colorCompoundBrandStroke: '#479ef5',
        colorCompoundBrandStrokePressed: '#2886de',
        colorPaletteRedForeground1: '#e37d80',
        colorBrandBackground: '#115ea3',
        colorBrandBackgroundHover: '#0f6cbd',
        colorBrandBackground2: '#082338',
        colorBrandStroke1: '#479ef5',
        colorBrandStroke2: '#0f548c',
        colorSubtleBackgroundHover: '#383838',
        colorSubtleBackgroundPressed: '#2e2e2e',
        colorStrokeFocus1: '#000000',
        colorStrokeFocus2: '#ffffff',
    };

    /** Themes the control can pass straight through to the provider. */
    var webLightTheme = { __harnessTheme: 'light' };
    var webDarkTheme = Object.assign({ __harnessTheme: 'dark' }, DARK_TOKENS);

    function FluentProvider(props) {
        var style = {};

        // A theme carrying tokens publishes them the way the real provider
        // does. One carrying none publishes none, so the stylesheet falls back
        // — which is a host, not a failure.
        Object.keys(props.theme || {}).forEach(function (key) {
            if (key.indexOf('color') === 0) {
                style['--' + key] = props.theme[key];
            }
        });

        return React.createElement(
            'div',
            { className: props.className, dir: props.dir, style: style },
            props.children,
        );
    }

    function PopoverTrigger(props) {
        return props.children;
    }

    PopoverTrigger.__harnessRole = 'trigger';

    function PopoverSurface(props) {
        return React.createElement(
            'div',
            {
                className: props.className,
                role: 'dialog',
                'aria-label': props['aria-label'],
                // Inline rather than portalled — see the header — but still
                // drawn as a layer, so what is on screen is not misleading
                // about how the control will look.
                style: {
                    position: 'absolute',
                    zIndex: 1,
                    // A floating layer sizes to its content. Absolute
                    // positioning alone sizes to the containing block, which
                    // squeezes a wide surface into the form column's width and
                    // makes the page lie about the layout.
                    width: 'max-content',
                    maxWidth: 'calc(100vw - 2rem)',
                    marginTop: '4px',
                    background: 'var(--colorNeutralBackground1, #ffffff)',
                    border: '1px solid var(--colorTransparentStroke, transparent)',
                    borderRadius: '4px',
                    boxShadow: '0 8px 16px rgba(0,0,0,.14), 0 0 2px rgba(0,0,0,.12)',
                },
            },
            props.children,
        );
    }

    PopoverSurface.__harnessRole = 'surface';

    function Popover(props) {
        var trigger = null;
        var surface = null;

        React.Children.forEach(props.children, function (child) {
            if (!child || !child.type) {
                return;
            }

            if (child.type.__harnessRole === 'trigger') {
                trigger = child;
            } else if (child.type.__harnessRole === 'surface') {
                surface = child;
            }
        });

        var toggle = function () {
            if (props.onOpenChange) {
                props.onOpenChange({}, { open: !props.open });
            }
        };

        /*
         * The real `PopoverTrigger` **clones its child** to add the click
         * handler, `aria-haspopup` and `aria-expanded`. Reproduced because it
         * is load-bearing in both directions: a control whose trigger is a
         * styled `<div>` gets those attributes for free, and a control that
         * puts a real `<button>` inside that `<div>` ends up with two tab stops
         * for one control. Neither is visible without this.
         */
        var child = trigger && trigger.props.children;
        var cloned = child
            ? React.cloneElement(child, {
                onClick: toggle,
                'aria-haspopup': 'dialog',
                'aria-expanded': props.open ? 'true' : 'false',
            })
            : null;

        return React.createElement(
            'div',
            { style: { position: 'relative' } },
            cloned,
            props.open ? surface : null,
        );
    }

    /*
     * `Button`: a real `<button>` carrying its appearance as a class, so a
     * stylesheet can be checked against the same element a form would have.
     * Hover and pressed states are the browser's. `disableButtonEnhancement`
     * is swallowed — it is a Fluent-internal hint, not an attribute.
     */
    function Button(props) {
        var attributes = {};

        Object.keys(props).forEach(function (key) {
            if (key !== 'children' && key !== 'appearance' && key !== 'size' && key !== 'disableButtonEnhancement' && key !== 'icon') {
                attributes[key] = props[key];
            }
        });

        attributes.type = attributes.type || 'button';
        attributes.className = ['stub-button', 'stub-button--' + (props.appearance || 'secondary'), props.className]
            .filter(Boolean)
            .join(' ');

        return React.createElement('button', attributes, props.children);
    }

    /*
     * The `Menu` family, compound like `Popover`: `Menu` finds its trigger and
     * popover among its children, holds open/closed in state, and draws the
     * popover **inline under the trigger** when open. The real one portals to
     * the body, traps focus and closes on Escape and on an outside click;
     * this one does none of that, which is the safe direction — a rule scoped
     * through the control's root matches the menu here and nothing on a form.
     * The trigger's child is cloned to take the click, as the real one does.
     */
    function MenuTrigger(props) {
        return props.children;
    }

    MenuTrigger.__harnessRole = 'trigger';

    function MenuPopover(props) {
        return React.createElement(
            'div',
            {
                role: 'menu',
                className: 'stub-menu',
                style: {
                    position: 'absolute',
                    zIndex: 1,
                    marginTop: '4px',
                    minWidth: '160px',
                    padding: '4px',
                    background: 'var(--colorNeutralBackground1, #ffffff)',
                    borderRadius: '4px',
                    boxShadow: '0 8px 16px rgba(0,0,0,.14), 0 0 2px rgba(0,0,0,.12)',
                },
            },
            props.children,
        );
    }

    MenuPopover.__harnessRole = 'surface';

    function MenuList(props) {
        return props.children;
    }

    function MenuItem(props) {
        return React.createElement(
            'button',
            {
                type: 'button',
                role: 'menuitem',
                className: 'stub-menuitem',
                disabled: props.disabled,
                onClick: props.onClick,
                style: { display: 'block', width: '100%', textAlign: 'start', font: 'inherit', background: 'none', border: 0, padding: '6px 12px', borderRadius: '4px', cursor: 'pointer' },
            },
            props.children,
        );
    }

    function Menu(props) {
        var state = React.useState(false);
        var open = state[0];
        var setOpen = state[1];
        var trigger = null;
        var surface = null;

        React.Children.forEach(props.children, function (child) {
            if (!child || !child.type) {
                return;
            }

            if (child.type.__harnessRole === 'trigger') {
                trigger = child;
            } else if (child.type.__harnessRole === 'surface') {
                surface = child;
            }
        });

        var child = trigger && trigger.props.children;
        var cloned = child
            ? React.cloneElement(child, {
                onClick: function () {
                    setOpen(!open);
                },
                'aria-haspopup': 'menu',
                'aria-expanded': open ? 'true' : 'false',
            })
            : null;

        return React.createElement(
            'div',
            {
                style: { position: 'relative', display: 'inline-block' },
                // A choice closes the menu, as it does on a form.
                onClickCapture: function (event) {
                    if (open && event.target && event.target.getAttribute && event.target.getAttribute('role') === 'menuitem') {
                        setOpen(false);
                    }
                },
            },
            cloned,
            open ? surface : null,
        );
    }

    global.__harnessFluent = {
        FluentProvider: FluentProvider,
        Popover: Popover,
        PopoverTrigger: PopoverTrigger,
        PopoverSurface: PopoverSurface,
        Button: Button,
        Menu: Menu,
        MenuTrigger: MenuTrigger,
        MenuPopover: MenuPopover,
        MenuList: MenuList,
        MenuItem: MenuItem,
        webLightTheme: webLightTheme,
        webDarkTheme: webDarkTheme,
    };
})(window);
