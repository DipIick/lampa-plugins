(function () {
    'use strict';

    // -------------------------------------------------------------------------
    // МАНИФЕСТ И НАСТРОЙКИ
    // -------------------------------------------------------------------------
    var MANIFEST = {
        id: 'dunhuatv_plugin_v3',
        version: '3.0.0',
        name: 'Дунхуа ТВ: Titan',
        description: 'Расширенная версия: Поиск, Закладки, Пагинация'
    };

    // Хранилище настроек и избранного
    var STORAGE = {
        getProxy: function() { 
            return Lampa.Storage.get('dunhua_proxy', 'https://corsproxy.io/?'); 
        },
        getFavorites: function() {
            return Lampa.Storage.get('dunhua_favorites', []);
        },
        setFavorites: function(favs) {
            Lampa.Storage.set('dunhua_favorites', favs);
        },
        baseUrl: 'https://dunhuatv.ru'
    };

    // -------------------------------------------------------------------------
    // ОСНОВНОЙ КОМПОНЕНТ
    // -------------------------------------------------------------------------
    function DunhuaComponent(object) {
        var comp = new Lampa.Component();
        var network = new Lampa.Reguest();
        
        // Переменные состояния
        var state = {
            page: 1,
            query: '', // Если не пусто - значит мы в режиме поиска
            items: [],
            last_focused: null
        };

        // UI Элементы
        var ui = {
            content: null,
            body: null,
            info: null
        };

        comp.create = function () {
            var _this = this;
            this.activity.loader(true);
            
            Lampa.Background.immediately('');

            // Создаем верхнюю панель
            ui.info = Lampa.Template.get('info', {
                title: MANIFEST.name,
                poster: ''
            });

            // --- НОВОЕ: ДОБАВЛЯЕМ КНОПКИ В ИНТЕРФЕЙС ---
            
            // 1. Кнопка "Поиск"
            var btn_search = $('<div class="info__button selector"><svg style="width: 24px; height: 24px;" viewBox="0 0 24 24"><path fill="currentColor" d="M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z" /></svg></div>');
            btn_search.on('hover:enter', function() {
                Lampa.Input.edit({
                    title: 'Поиск Дунхуа',
                    value: '',
                    free: true,
                    nosave: true
                }, function(new_query) {
                    if (new_query) {
                        // Сбрасываем страницу и переходим в режим поиска
                        state.page = 1;
                        state.query = new_query;
                        state.items = []; // Очищаем старое
                        ui.info.find('.info__title').text('Поиск: ' + new_query);
                        _this.loadData();
                    }
                });
            });
            ui.info.find('.info__right').prepend(btn_search);

            // 2. Кнопка "Избранное"
            var btn_fav = $('<div class="info__button selector"><svg style="width: 24px; height: 24px;" viewBox="0 0 24 24"><path fill="currentColor" d="M12,21.35L10.55,20.03C5.4,15.36 2,12.27 2,8.5C2,5.41 4.42,3 7.5,3C9.24,3 10.91,3.81 12,5.08C13.09,3.81 14.76,3 16.5,3C19.58,3 22,5.41 22,8.5C22,12.27 18.6,15.36 13.45,20.03L12,21.35Z" /></svg></div>');
            btn_fav.on('hover:enter', function() {
                var favs = STORAGE.getFavorites();
                if(favs.length === 0) {
                    Lampa.Noty.show('Избранное пусто');
                } else {
                    state.items = favs; // Загружаем из памяти
                    state.query = 'favorites'; // Маркер режима
                    ui.info.find('.info__title').text('Избранное');
                    _this.build(state.items, false); // false = не показывать кнопку "Далее"
                    _this.activity.loader(false);
                }
            });
            ui.info.find('.info__right').prepend(btn_fav);

            // Инициализация контента
            ui.content = $('<div class="category-full"></div>');
            ui.body = $('<div class="category-full__body"></div>');
            ui.content.append(ui.body);
            this.activity.append(ui.content);

            // Загружаем первую страницу
            this.loadData();
            
            return ui.info;
        };

        // -------------------------------------------------------------------------
        // ЛОГИКА ЗАГРУЗКИ (ГЛАВНАЯ / ПОИСК / СТРАНИЦЫ)
        // -------------------------------------------------------------------------
        comp.loadData = function () {
            var _this = this;
            this.activity.loader(true);
            
            var url = '';
            var proxy = STORAGE.getProxy();
            
            if (state.query && state.query !== 'favorites') {
                // Режим поиска (DLE стандарт)
                // Обычно поиск на DLE идет через POST, но попробуем GET параметры или структуру URL
                // Частый вариант для DLE: index.php?do=search&subaction=search&story=ЗАПРОС
                // Для Lampa и прокси лучше кодировать
                
                // ВАЖНО: Кодировка Windows-1251 часто встречается на старых DLE, но современные UTF-8. 
                // Предполагаем UTF-8.
                url = proxy + encodeURIComponent(STORAGE.baseUrl + '/index.php?do=search&subaction=search&story=' + state.query + '&from_page=' + state.page);
            } else {
                // Режим обычной навигации
                if (state.page === 1) {
                    url = proxy + encodeURIComponent(STORAGE.baseUrl);
                } else {
                    // Пагинация: site.ru/page/2/
                    url = proxy + encodeURIComponent(STORAGE.baseUrl + '/page/' + state.page + '/');
                }
            }

            network.silent(url, function (str) {
                _this.parseHTML(str);
            }, function (a, c) {
                Lampa.Noty.show('Ошибка сети. Код: ' + network.errorDecode(a));
                _this.activity.loader(false);
            });
        };

        // -------------------------------------------------------------------------
        // ПАРСИНГ HTML (УЛУЧШЕННЫЙ)
        // -------------------------------------------------------------------------
        comp.parseHTML = function(str) {
            var parser = new DOMParser();
            var doc = parser.parseFromString(str, "text/html");
            
            // Расширенный список селекторов (чтобы наверняка)
            var selectors = ['.shortstory', '.custom-poster', '.th-item', '.item', '.movie-item', '.story'];
            var found_new_items = [];
            
            for (var i = 0; i < selectors.length; i++) {
                var els = doc.querySelectorAll(selectors[i]);
                if (els.length > 0) {
                    els.forEach(function(el) {
                        var item = {};
                        
                        var img = el.querySelector('img');
                        var link = el.querySelector('a');
                        // Ищем заголовок даже в alt картинки, если нет текста
                        var title = el.querySelector('.short-title, .title, h2, h3, .custom-poster__title');
                        
                        if (img && link) {
                            item.img = img.getAttribute('data-src') || img.getAttribute('src');
                            item.url = link.getAttribute('href');
                            item.title = title ? title.innerText.trim() : (img.getAttribute('alt') || 'Без названия');
                            
                            // Исправляем ссылки
                            if (item.img && item.img.indexOf('http') === -1) item.img = STORAGE.baseUrl + (item.img.startsWith('/') ? '' : '/') + item.img;
                            if (item.url && item.url.indexOf('http') === -1) item.url = STORAGE.baseUrl + (item.url.startsWith('/') ? '' : '/') + item.url;
                            
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
                // Если это первая страница, чистим экран. Если 2,3... то добавляем.
                if (state.page === 1) {
                    ui.body.empty();
                    state.items = found_new_items;
                } else {
                    state.items = state.items.concat(found_new_items);
                }
                
                this.build(found_new_items, true); // true = добавить кнопку "Далее"
            }
            this.activity.loader(false);
        };

        // -------------------------------------------------------------------------
        // ПОСТРОЕНИЕ ИНТЕРФЕЙСА (RENDER)
        // -------------------------------------------------------------------------
        comp.build = function (items, show_next_btn) {
            var _this = this;
            
            // Удаляем старую кнопку "Далее", если она была
            ui.body.find('.selector_next_page').remove();

            items.forEach(function (element) {
                var card = Lampa.Template.js('card', {
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

            // Кнопка "Далее" (если не режим избранного)
            if (show_next_btn && state.query !== 'favorites') {
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

        // Логика пульта для ТВ
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
                right: function () { Navigator.move('right'); },
                up: function () { 
                    if (Navigator.canmove('up')) Navigator.move('up');
                    else Lampa.Controller.toggle('head'); 
                },
                down: function () { Navigator.move('down'); },
                back: function () { Lampa.Activity.back(); }
            });
        };

        // -------------------------------------------------------------------------
        // ДЕТАЛИ И МЕНЮ ДЕЙСТВИЙ
        // -------------------------------------------------------------------------
        comp.openDetails = function(element) {
            // Проверяем, есть ли уже в избранном
            var favs = STORAGE.getFavorites();
            var is_fav = favs.some(function(f) { return f.url === element.url; });
            var fav_title = is_fav ? 'Удалить из Избранного' : 'Добавить в Избранное';

            Lampa.Select.show({
                title: element.title,
                items: [
                    {title: 'Смотреть (Поиск плеера)', action: 'play'},
                    {title: fav_title, action: 'fav'},
                    {title: 'Открыть через браузер', action: 'web'},
                    {title: 'Найти в Lampa (Глобально)', action: 'search_global'}
                ],
                onSelect: function(a) {
                    if(a.action === 'web') Lampa.Android.open(element.url);
                    
                    if(a.action === 'search_global') {
                        Lampa.Activity.push({
                            url: '', title: 'Поиск', component: 'search', page: 1, query: element.title
                        });
                    }

                    if(a.action === 'fav') {
                        if(is_fav) {
                            // Удаление
                            var new_favs = favs.filter(function(f) { return f.url !== element.url; });
                            STORAGE.setFavorites(new_favs);
                            Lampa.Noty.show('Удалено');
                        } else {
                            // Добавление
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
                                
                                // Расширенный поиск iframe
                                var iframes = doc.querySelectorAll('iframe');
                                var found_video = false;
                                
                                if(iframes.length > 0) {
                                    // Берем первый iframe
                                    // Здесь можно добавить логику фильтрации рекламы
                                    var src = iframes[0].src;
                                    Lampa.Player.play({ url: src, title: element.title });
                                    found_video = true;
                                }

                                if(!found_video) Lampa.Noty.show('Плеер не найден автоматически.');
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

    // -------------------------------------------------------------------------
    // ЗАПУСК
    // -------------------------------------------------------------------------
    function startPlugin() {
        window.plugin_dunhuatv_v3_ready = true;
        Lampa.Component.add('dunhuatv', DunhuaComponent);
        
        Lampa.Settings.listener.follow('open', function (e) {
            if (e.name == 'main') {
                var item = Lampa.Template.js('menu_item', {
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

    if (!window.plugin_dunhuatv_v3_ready) {
        startPlugin();
    }
})();