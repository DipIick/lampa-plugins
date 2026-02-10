(function () {
    'use strict';

    var MANIFEST = {
        id: 'dunhuatv_plugin_root',
        version: '11.0.0',
        name: 'Дунхуа ТВ',
        description: 'Официальный клиент dunhuatv.ru'
    };

    var SETTINGS = {
        get: function(name, def) { return Lampa.Storage.get('dunhua_' + name, def); },
        set: function(name, value) { Lampa.Storage.set('dunhua_' + name, value); }
    };

    function Component(object) {
        var comp = new Lampa.Component();
        var network = new Lampa.Reguest();
        var state = { page: 1, query: '', items: [], mode: 'main' };
        var ui = { info: null, body: null };

        comp.create = function () {
            this.activity.loader(true);
            Lampa.Background.immediately('');
            
            ui.info = Lampa.Template.get('info', { title: MANIFEST.name, poster: '' });
            
            var btn_search = $('<div class="info__button selector"><svg style="width: 24px; height: 24px;" viewBox="0 0 24 24"><path fill="currentColor" d="M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z" /></svg></div>');
            btn_search.on('hover:enter', function() {
                Lampa.Input.edit({ title: 'Поиск', value: '', free: true, nosave: true }, function(val) {
                    if (val) { state.page = 1; state.query = val; state.mode = 'search'; state.items = []; ui.info.find('.info__title').text('Поиск: ' + val); comp.load(); }
                });
            });
            ui.info.find('.info__right').prepend(btn_search);

            var btn_fav = $('<div class="info__button selector"><svg style="width: 24px; height: 24px;" viewBox="0 0 24 24"><path fill="currentColor" d="M12,21.35L10.55,20.03C5.4,15.36 2,12.27 2,8.5C2,5.41 4.42,3 7.5,3C9.24,3 10.91,3.81 12,5.08C13.09,3.81 14.76,3 16.5,3C19.58,3 22,5.41 22,8.5C22,12.27 18.6,15.36 13.45,20.03L12,21.35Z" /></svg></div>');
            btn_fav.on('hover:enter', function() {
                var favs = SETTINGS.get('favorites', []);
                if(favs.length) { state.items = favs; state.mode = 'favs'; ui.info.find('.info__title').text('Избранное'); comp.build(favs, false); this.activity.loader(false); } 
                else Lampa.Noty.show('Избранное пусто');
            });
            ui.info.find('.info__right').prepend(btn_fav);

            ui.body = $('<div class="category-full"></div>');
            this.activity.append(ui.body);
            
            this.load();
            return ui.info;
        };

        comp.load = function() {
            this.activity.loader(true);
            var proxy = SETTINGS.get('proxy', 'https://corsproxy.io/?');
            var base = 'https://dunhuatv.ru';
            var url = state.mode === 'search' ? 
                proxy + encodeURIComponent(base + '/index.php?do=search&subaction=search&story=' + state.query + '&from_page=' + state.page) :
                proxy + encodeURIComponent(base + (state.page > 1 ? '/page/' + state.page + '/' : ''));

            network.silent(url, function(str) { comp.parse(str); }, function() { Lampa.Noty.show('Ошибка сети'); comp.activity.loader(false); });
        };

        comp.parse = function(str) {
            var doc = new DOMParser().parseFromString(str, "text/html");
            var items = [];
            var sels = ['.shortstory', '.custom-poster', '.item', '.movie-item'];
            
            for(var i=0; i<sels.length; i++) {
                var els = doc.querySelectorAll(sels[i]);
                if(els.length) {
                    els.forEach(function(el) {
                        var img = el.querySelector('img');
                        var a = el.querySelector('a');
                        var t = el.querySelector('.short-title, .title, h2, h3');
                        if(img && a) {
                            var src = img.getAttribute('data-src') || img.getAttribute('src');
                            var href = a.getAttribute('href');
                            if(src && src.indexOf('http') == -1) src = 'https://dunhuatv.ru' + src;
                            if(href && href.indexOf('http') == -1) href = 'https://dunhuatv.ru' + href;
                            items.push({ title: t ? t.innerText.trim() : 'Anime', img: src, url: href });
                        }
                    });
                    break;
                }
            }
            if(state.page == 1) ui.body.empty();
            if(items.length) { 
                if(state.page > 1) state.items = state.items.concat(items);
                else state.items = items;
                this.build(items, true); 
            } else Lampa.Noty.show(state.page == 1 ? 'Пусто' : 'Конец');
            this.activity.loader(false);
        };

        comp.build = function(items, more) {
            ui.body.find('.selector_next').remove();
            items.forEach(function(it) {
                var card = Lampa.Template.get('card', { title: it.title, release_year: '' });
                card.addClass('card--vertical');
                card.find('img').attr('src', it.img);
                card.on('hover:enter', function() { comp.open(it); });
                ui.body.append(card);
            });
            if(more && state.mode !== 'favs') {
                var btn = $('<div class="selector selector_next" style="padding: 20px; text-align: center;">Далее</div>');
                btn.on('hover:enter', function() { state.page++; comp.load(); });
                ui.body.append(btn);
            }
            this.activity.toggle();
        };

        comp.open = function(it) {
            Lampa.Select.show({
                title: it.title,
                items: [{title: 'Смотреть', id: 1}, {title: 'В избранное', id: 2}],
                onSelect: function(a) {
                    if(a.id == 2) {
                        var favs = SETTINGS.get('favorites', []);
                        favs.push(it); SETTINGS.set('favorites', favs);
                        Lampa.Noty.show('Добавлено');
                    }
                    if(a.id == 1) {
                        Lampa.Loading.start(function() {
                            var p = SETTINGS.get('proxy', 'https://corsproxy.io/?');
                            network.silent(p + encodeURIComponent(it.url), function(s) {
                                Lampa.Loading.stop();
                                var d = new DOMParser().parseFromString(s, "text/html");
                                var f = d.querySelector('iframe');
                                if(f) Lampa.Player.play({url: f.src, title: it.title});
                                else Lampa.Noty.show('Плеер не найден');
                            });
                        });
                    }
                }
            });
        };
        return comp;
    }

    function init() {
        Lampa.Component.add('dunhuatv', Component);
        
        // 1. Метод встраивания из плагина MODS (Самый надежный)
        var btn = Lampa.Template.get('menu_item', {
            title: MANIFEST.name,
            icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8 12.5v-9l6 4.5-6 4.5z"/></svg>'
        });
        
        btn.on('hover:enter', function() {
            Lampa.Activity.push({ url: '', title: MANIFEST.name, component: 'dunhuatv', page: 1 });
        });

        // Добавляем в настройки плагинов (Резерв)
        Lampa.Settings.listener.follow('open', function(e) {
            if(e.name == 'plugins') {
                var field = Lampa.Template.get('settings_param', { name: 'Дунхуа ТВ', value: 'Настроить прокси', desc: 'Управление плагином' });
                field.on('hover:enter', function() {
                    Lampa.Input.edit({ title: 'Прокси', value: SETTINGS.get('proxy', 'https://corsproxy.io/?'), free: true }, function(v) { SETTINGS.set('proxy', v); });
                });
                e.body.find('.settings__content').append(field);
            }
        });

        // Основной цикл встраивания
        function insert() {
            var menu = $('.menu .menu__list');
            if(menu.length) {
                if(menu.find('.dunhua-plugin-btn').length == 0) {
                    btn.addClass('dunhua-plugin-btn');
                    menu.prepend(btn); // Вставляем в САМЫЙ ВЕРХ
                }
            } else {
                setTimeout(insert, 500);
            }
        }
        insert();
    }

    if(window.appready) init();
    else Lampa.Listener.follow('app', function(e) { if(e.type == 'ready') init(); });
})();
