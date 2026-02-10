(function () {
    'use strict';

    var MANIFEST = {
        id: 'dunhuatv_plugin_pro',
        version: '5.0.0',
        name: 'Дунхуа ТВ',
        description: 'Расширенная версия: Поиск, Избранное, Настройки',
        type: 'video',
        author: 'DipIick'
    };

    var STORAGE = {
        getProxy: function() { 
            return Lampa.Storage.get('dunhua_proxy', 'https://corsproxy.io/?'); 
        },
        setProxy: function(value) {
            Lampa.Storage.set('dunhua_proxy', value);
        },
        getFavorites: function() {
            return Lampa.Storage.get('dunhua_favorites', []);
        },
        setFavorites: function(favs) {
            Lampa.Storage.set('dunhua_favorites', favs);
        },
        baseUrl: 'https://dunhuatv.ru'
    };

    function DunhuaComponent(object) {
        var comp = new Lampa.Component();
        var network = new Lampa.Reguest();
        var state = {
            page: 1,
            query: '',
            items: [],
            last_focused: null,
            mode: 'main'
        };

        var ui = {
            content: null,
            body: null,
            info: null,
            loader: null
        };

        comp.create = function () {
            var _this = this;
            this.activity.loader(true);
            
            Lampa.Background.immediately('');

            ui.info = Lampa.Template.get('info', {
                title: MANIFEST.name,
                poster: ''
            });

            var btn_settings = $('<div class="info__button selector"><svg style="width: 24px; height: 24px;" viewBox="0 0 24 24"><path fill="currentColor" d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/></svg></div>');
            btn_settings.on('hover:enter', function() {
                _this.openSettings();
            });
            ui.info.find('.info__right').prepend(btn_settings);

            var btn_search = $('<div class="info__button selector"><svg style="width: 24px; height: 24px;" viewBox="0 0 24 24"><path fill="currentColor" d="M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z" /></svg></div>');
            btn_search.on('hover:enter', function() {
                Lampa.Input.edit({
                    title: 'Поиск Дунхуа',
                    value: '',
                    free: true,
                    nosave: true
                }, function(new_query) {
                    if (new_query) {
                        state.page = 1;
                        state.query = new_query;
                        state.mode = 'search';
                        state.items = [];
                        ui.info.find('.info__title').text('Поиск: ' + new_query);
                        _this.loadData();
                    }
                });
            });
            ui.info.find('.info__right').prepend(btn_search);

            var btn_fav = $('<div class="info__button selector"><svg style="width: 24px; height: 24px;" viewBox="0 0 24 24"><path fill="currentColor" d="M12,21.35L10.55,20.03C5.4,15.36 2,12.27 2,8.5C2,5.41 4.42,3 7.5,3C9.24,3 10.91,3.81 12,5.08C13.09,3.81 14.76,3 16.5,3C19.58,3 22,5.41 22,8.5C22,12.27 18.6,15.36 13.45,20.03L12,21.35Z" /></svg></div>');
            btn_fav.on('hover:enter', function() {
                var favs = STORAGE.getFavorites();
                if(favs.length === 0) {
                    Lampa.Noty.show('Избранное пусто');
                } else {
                    state.items = favs;
                    state.mode = 'favorites';
                    state.query = '';
                    ui.info.find('.info__title').text('Избранное');
                    _this.build(state.items, false);
                    _this.activity.loader(false);
                }
            });
            ui.info.find('.info__right').prepend(btn_fav);

            ui.content = $('<div class="category-full"></div>');
            ui.body = $('<div class="category-full__body"></div>');
            ui.content.append(ui.body);
            this.activity.append(ui.content);

            this.loadData();
            
            return ui.info;
        };

        comp.openSettings = function() {
            Lampa.Input.edit({
                title: 'Настройка CORS прокси',
                value: STORAGE.getProxy(),
                free: true,
                nosave: false
            }, function(new_proxy) {
                STORAGE.setProxy(new_proxy);
                Lampa.Noty.show('Прокси сохранен. Перезагрузите раздел.');
            });
        };

        comp.loadData = function () {
            var _this = this;
            this.activity.loader(true);
            
            var url = '';
            var proxy = STORAGE.getProxy();
            
            if (state.mode === 'search') {
                url = proxy + encodeURIComponent(STORAGE.baseUrl + '/index.php?do=search&subaction=search&story=' + state.query + '&from_page=' + state.page);
            } else {
                if (state.page === 1) {
                    url = proxy + encodeURIComponent(STORAGE.baseUrl);
                } else {
                    url = proxy + encodeURIComponent(STORAGE.baseUrl + '/page/' + state.page + '/');
                }
            }

            network.silent(url, function (str) {
                _this.parseHTML(str);
            }, function (a, c) {
                Lampa.Noty.show('Ошибка сети: ' + network.errorDecode(a));
                _this.activity.loader(false);
            });
        };

        comp.parseHTML = function(str) {
            var parser = new DOMParser();
            var doc = parser.parseFromString(str, "text/html");
            
            var selectors = ['.shortstory', '.custom-poster', '.th-item', '.item', '.movie-item', '.story'];
            var found_new_items = [];
            
            for (var i = 0; i < selectors.length; i++) {
                var els = doc.querySelectorAll(selectors[i]);
                if (els.length > 0) {
                    els.forEach(function(el) {
                        var item = {};
                        
                        var img = el.querySelector('img');
                        var link = el.querySelector('a');
                        var title = el.querySelector('.short-title, .title, h2, h3, .custom-poster__title');
                        
                        if (img && link) {
                            item.img = img.getAttribute('data-src') || img.getAttribute('src');
                            item.url = link.getAttribute('href');
                            item.title = title ? title.innerText.trim() : (img.getAttribute('alt') || 'Без названия');
                            
                            if (item.img && item.img.indexOf('http') === -1) {
                                item.img = STORAGE.baseUrl + (item.img.startsWith('/') ? '' : '/') + item.img;
                            }
                            if (item.url && item.url.indexOf('http') === -1) {
                                item.url = STORAGE.baseUrl + (item.url.startsWith('/') ? '' : '/') + item.url;
                            }
                            
                            found_new_items.push(item);
                        }
                    });
                    break;
                }
            }

            if (found_new_items.length === 0) {
                if(state.page === 1) Lampa.Noty.show('Ничего не найдено.');
                else Lampa.Noty.show('Больше страниц нет.');
            } else {
                if (state.page === 1) {
                    ui.body.empty();
                    state.items = found_new_items;
                } else {
                    state.items = state.items.concat(found_new_items);
                }
                
                this.build(found_new_items, true);
            }
            this.activity.loader(false);
        };

        comp.build = function (items, show_next_btn) {
            var _this = this;
            
            ui.body.find('.selector_next_page').remove();

            items.forEach(function (element) {
                var card = Lampa.Template.get('card', {
                    title: element.title,
                    release_year: ''
                });
                
                card.find('img').attr('src', element.img);
                card.addClass('card--vertical');

                card.on('hover:focus', function() {
                    state.last_focused = this;
                });

                card.on('hover:enter', function () {
                   _this.openDetails(element);
                });

                ui.body.append(card);
            });

            if (show_next_btn && state.mode !== 'favorites') {
                var btn_next = $('<div class="selector selector_next_page" style="width: 100%; height: 50px; background: rgba(255,255,255,0.1); text-align: center; line-height: 50px; margin-top: 20px; border-radius: 5px;">Следующая страница</div>');
                
                btn_next.on('hover:enter', function() {
                    state.page++;
                    _this.loadData();
                });
                
                ui.body.append(btn_next);
            }

            this.updateController();
            this.activity.toggle();
        };

        comp.updateController = function() {
            var _this = this;
            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(ui.content);
                    Lampa.Controller.collectionFocus(state.last_focused ? state.last_focused : false, ui.content);
                },
                left: function () {
                    if (Navigator.canmove('left')) Navigator.move('left');
                    else Lampa.Controller.toggle('menu'); 
                },
                right: function () {
                    Navigator.move('right'); 
                },
                up: function () { 
                    if (Navigator.canmove('up')) Navigator.move('up');
                    else Lampa.Controller.toggle('head'); 
                },
                down: function () {
                    Navigator.move('down'); 
                },
                back: function () {
                    Lampa.Activity.back(); 
                }
            });
        };

        comp.openDetails = function(element) {
            var favs = STORAGE.getFavorites();
            var is_fav = favs.some(function(f) { return f.url === element.url; });
            var fav_title = is_fav ? 'Удалить из Избранного' : 'Добавить в Избранное';

            Lampa.Select.show({
                title: element.title,
                items: [
                    {title: 'Смотреть', action: 'play'},
                    {title: fav_title, action: 'fav'},
                    {title: 'Открыть через браузер', action: 'web'},
                    {title: 'Найти в Lampa (Глобально)', action: 'search_global'}
                ],
                onSelect: function(a) {
                    if(a.action === 'web') {
                        Lampa.Android.open(element.url);
                    }
                    
                    if(a.action === 'search_global') {
                        Lampa.Activity.push({
                            url: '', title: 'Поиск', component: 'search', page: 1, query: element.title
                        });
                    }

                    if(a.action === 'fav') {
                        if(is_fav) {
                            var new_favs = favs.filter(function(f) { return f.url !== element.url; });
                            STORAGE.setFavorites(new_favs);
                            Lampa.Noty.show('Удалено из избранного');
                        } else {
                            favs.push(element);
                            STORAGE.setFavorites(favs);
                            Lampa.Noty.show('Добавлено в избранное');
                        }
                    }

                    if(a.action === 'play') {
                        Lampa.Loading.start(function() {
                            var url = STORAGE.getProxy() + encodeURIComponent(element.url);
                            network.silent(url, function(str) {
                                Lampa.Loading.stop();
                                var doc = new DOMParser().parseFromString(str, "text/html");
                                
                                var iframes = doc.querySelectorAll('iframe');
                                var found_video = false;
                                
                                if(iframes.length > 0) {
                                    var src = iframes[0].src;
                                    Lampa.Player.play({ url: src, title: element.title });
                                    found_video = true;
                                }

                                if(!found_video) {
                                    Lampa.Noty.show('Плеер не найден автоматически.');
                                }
                            });
                        });
                    }
                }
            });
        };

        comp.destroy = function () {
            network.clear();
            state = null;
            ui = null;
        };

        return comp;
    }

    function startPlugin() {
        window.plugin_dunhuatv_pro_ready = true;
        
        Lampa.Component.add('dunhuatv', DunhuaComponent);
        
        Lampa.Settings.listener.follow('open', function (e) {
            if (e.name == 'main') {
                var item = Lampa.Template.get('menu_item', {
                    title: MANIFEST.name,
                    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>'
                });
                item.on('hover:enter', function () {
                    Lampa.Activity.push({ url: '', title: MANIFEST.name, component: 'dunhuatv', page: 1 });
                });
                $('.menu .menu__list').eq(0).append(item);
            }
        });
    }

    if (!window.plugin_dunhuatv_pro_ready) {
        startPlugin();
    }
})();

