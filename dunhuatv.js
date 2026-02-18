(function () {
    'use strict';

    // Конфигурация плагина
    var Manifest = {
        id: 'dunhuatv_plugin',
        version: '1.0.0',
        name: 'DunhuaTV',
        description: 'Смотрите аниме с dunhuatv.ru. Глубокая интеграция, поиск, избранное.',
        component: 'dunhuatv',
        source: 'https://dunhuatv.ru',
        // Публичный CORS прокси. Рекомендуется заменить на свой в настройках, если этот упадет.
        proxy: 'https://cors.eu.org/' 
    };

    var Lampa = window.Lampa;
    var Network = Lampa.Network;
    var Utils = Lampa.Utils;

    // --- Хранилище настроек и данных ---
    var DB = {
        get: function(name, def) {
            return Lampa.Storage.get('dunhua_' + name, def);
        },
        set: function(name, value) {
            Lampa.Storage.set('dunhua_' + name, value);
        }
    };

    // --- Сетевой слой с поддержкой Прокси ---
    var API = {
        request: function (url, success, error) {
            var proxy = DB.get('proxy', Manifest.proxy);
            var use_proxy = DB.get('use_proxy', true);
            
            // Если включен прокси и это не локальный запрос
            var final_url = (use_proxy && url.indexOf('http') === 0) ? proxy + url : url;

            Network.silent(final_url, function (str) {
                success(str);
            }, function (a, c) {
                // Если ошибка, пробуем без прокси или уведомляем
                if(use_proxy) {
                     Lampa.Noty.show('Ошибка сети через прокси. Пробую напрямую...');
                     Network.silent(url, success, error);
                } else {
                    error(a, c);
                }
            });
        },
        
        // Парсер контента DLE (Адаптированный под DunhuaTV)
        parseCatalog: function (html) {
            var doc = new DOMParser().parseFromString(html, 'text/html');
            var items = [];

            // Селекторы под DLE структуру dunhuatv
            var elements = doc.querySelectorAll('.custom-poster, .shortstory, .item'); 

            elements.forEach(function (el) {
                var linkEl = el.querySelector('a');
                var imgEl = el.querySelector('img');
                var titleEl = el.querySelector('.custom-poster-title, .title, h2');
                var dateEl = el.querySelector('.custom-poster-date, .date');
                var qualEl = el.querySelector('.quality, .full-quality');

                if (linkEl && imgEl) {
                    items.push({
                        url: linkEl.getAttribute('href'),
                        img: imgEl.getAttribute('src') || imgEl.getAttribute('data-src'),
                        title: titleEl ? titleEl.innerText.trim() : 'Без названия',
                        original_title: '', // DLE редко отдает ориг. название в сетке
                        year: dateEl ? dateEl.innerText.trim() : '',
                        quality: qualEl ? qualEl.innerText.trim() : 'TV',
                        type: 'series' // По дефолту считаем сериалами
                    });
                }
            });

            // Поиск пагинации
            var next_page = doc.querySelector('.navigation a:last-child, .pnext a');
            var page = next_page ? next_page.getAttribute('href') : false;

            return { list: items, page: page };
        },

        parseFull: function (html) {
            var doc = new DOMParser().parseFromString(html, 'text/html');
            
            var title = doc.querySelector('h1.title, h1');
            var desc = doc.querySelector('.full-text, .f-desc');
            var poster = doc.querySelector('.full-poster img, .f-poster img');
            var meta = [];
            
            // Сбор мета-информации (Год, Жанры и т.д.)
            doc.querySelectorAll('.f-info li, .short-info li').forEach(function(el){
                meta.push(el.innerText.trim());
            });

            // Поиск плееров (Iframe)
            var iframes = [];
            doc.querySelectorAll('iframe').forEach(function(el){
                var src = el.getAttribute('src') || el.getAttribute('data-src');
                if(src && (src.indexOf('kodik') > -1 || src.indexOf('sibnet') > -1 || src.indexOf('youtube') > -1 || src.indexOf('alloha') > -1)) {
                    iframes.push(src);
                }
            });

            // Поиск плееров в табах (скрипты Kodik)
            // Это упрощенная логика, часто ссылки закодированы, но для базового DLE работает
            if(iframes.length === 0 && html.indexOf('kodik') > -1) {
                // Пытаемся вытянуть ссылку регуляркой если нет iframe
                var match = html.match(/src=["'](https:\/\/kodik\.[^"']+)["']/);
                if(match) iframes.push(match[1]);
            }

            return {
                title: title ? title.innerText.trim() : 'Без названия',
                description: desc ? desc.innerText.trim() : '',
                img: poster ? (poster.getAttribute('src') || poster.getAttribute('data-src')) : '',
                meta: meta.join(' • '),
                iframes: iframes
            };
        }
    };

    // --- Основной компонент (Каталог) ---
    function DunhuaComponent(object) {
        var comp = new Lampa.InteractionMain(object);

        comp.create = function () {
            this.activity.loader(true);
            
            // Заголовок и фильтры
            this.activity.head = Lampa.Template.get('head', { title: 'DunhuaTV' });
            this.activity.head.querySelector('.open--search').addEventListener('click', function(){
                Lampa.Input.edit({
                    title: 'Поиск Anime',
                    value: '',
                    free: true,
                    nosave: true
                }, function (new_value) {
                    comp.activity.loader(true);
                    comp.startSearch(new_value);
                });
            });

            // Сетка контента
            this.activity.line = Lampa.Template.get('items_line', { title: 'Последние обновления' });
            this.activity.render().find('.activity__body').append(this.activity.head);
            this.activity.render().find('.activity__body').append(this.activity.line);
            
            return this.render();
        };

        comp.startSearch = function(query) {
            this.url = Manifest.source + '/index.php?do=search&subaction=search&story=' + encodeURIComponent(query);
            this.page = 1;
            this.activity.line.find('.card').remove(); // Очистка
            this.load();
        };

        comp.start = function () {
            this.url = Manifest.source;
            this.page = 1;
            this.load();
        };

        comp.load = function () {
            var _this = this;
            
            // Формируем URL. Если это пагинация, она уже полная. Если старт - корень.
            var requestUrl = this.url;

            API.request(requestUrl, function (html) {
                var data = API.parseCatalog(html);
                
                _this.buildItems(data.list);
                
                _this.activity.loader(false);
                
                // Логика "Ещё" (Пагинация)
                if (data.page) {
                    _this.url = data.page;
                    // В реальном DLE ссылка пагинации может быть относительной
                    if(_this.url.indexOf('http') === -1) _this.url = Manifest.source + _this.url;
                } else {
                    _this.url = false;
                }
            }, function () {
                _this.activity.loader(false);
                _this.activity.empty();
            });
        };

        comp.buildItems = function (items) {
            var _this = this;
            
            if(!items.length) {
                Lampa.Noty.show('Ничего не найдено');
                return;
            }

            items.forEach(function (item) {
                // Создаем карточку в стиле Lampa
                var card = Lampa.Template.get('card', {
                    title: item.title,
                    release_year: item.year
                });

                // Качество (Badge)
                card.find('.card__view').append('<div class="card__quality">' + item.quality + '</div>');

                // Картинка
                var img = card.find('.card__img')[0];
                var img_url = item.img;
                if(img_url && img_url.indexOf('http') === -1) img_url = Manifest.source + img_url;
                
                img.onload = function () { card.addClass('card--loaded'); };
                img.error = function () { img.src = './img/img_broken.svg'; };
                img.src = img_url;

                // Действие при клике
                card.on('hover:enter', function () {
                    _this.openFull(item, img_url);
                });

                // Контекстное меню (долгое нажатие)
                card.on('hover:long', function () {
                     Lampa.Select.show({
                        title: 'Меню',
                        items: [
                            { title: 'Добавить в закладки Lampa', to_fav: true },
                            { title: 'Закрыть' }
                        ],
                        onSelect: function(a) {
                            if(a.to_fav) {
                                Lampa.Favorite.add('card', {
                                    id: Utils.uid(item.title),
                                    title: item.title,
                                    img: img_url,
                                    url: item.url,
                                    source: 'dunhua'
                                });
                            }
                        }
                     });
                });

                _this.activity.line.find('.card-loaded').remove(); // удаляем лоадер "еще"
                _this.activity.line.append(card);
            });
            
            // Кнопка "Показать еще"
            if(this.url) {
                var more = Lampa.Template.get('more');
                more.on('hover:enter', function () {
                    _this.load();
                });
                this.activity.line.append(more);
            }
            
            this.activity.toggle(); // Обновить контроллер
        };

        // --- Полная карточка и плеер ---
        comp.openFull = function (item, img_full_url) {
            var full_url = item.url;
            if(full_url.indexOf('http') === -1) full_url = Manifest.source + full_url;

            Lampa.Activity.push({
                url: full_url,
                title: item.title,
                component: 'dunhua_full',
                page: 1
            });
        };

        return comp;
    }

    // --- Компонент полной новости (Player wrapper) ---
    function DunhuaFull(object) {
        var comp = new Lampa.InteractionMain(object);

        comp.create = function () {
            this.activity.loader(true);
            return this.render();
        };

        comp.start = function () {
            var _this = this;
            API.request(object.url, function(html) {
                var data = API.parseFull(html);
                
                // Создаем UI полной новости, используя шаблон 'view' (как у фильмов)
                var info = [
                    { name: 'Название', value: data.title },
                    { name: 'Инфо', value: data.meta }
                ];

                var desc = Lampa.Template.get('description', {
                    title: data.title,
                    descr: data.description
                });
                
                // Устанавливаем фон (Backdrop)
                Lampa.Activity.active().activity.render().find('.background').attr('src', data.img);

                // Кнопки действий
                var buttons = $('<div class="buttons"></div>');
                
                // Кнопка "Смотреть"
                var btn_play = Lampa.Template.get('button', { title: 'Смотреть' });
                btn_play.on('hover:enter', function() {
                    if(data.iframes.length > 0) {
                        _this.play(data);
                    } else {
                        Lampa.Noty.show('Ссылки на видео не найдены');
                    }
                });
                buttons.append(btn_play);

                // Рендеринг
                _this.activity.render().find('.activity__body').append(desc);
                _this.activity.render().find('.activity__body').append(buttons);
                _this.activity.loader(false);
                _this.activity.toggle();

            }, function() {
                _this.activity.empty();
            });
        };

        comp.play = function(data) {
            // Если iframe один - сразу играем, если много - выбор
            var items = data.iframes.map(function(url, i){
                return {
                    title: 'Источник ' + (i+1),
                    url: url
                };
            });

            var playVideo = function(url) {
                var video = {
                    title: data.title,
                    url: url,
                    timeline: {
                        hash: Lampa.Utils.uid(data.title) // Для истории просмотра
                    }
                };
                Lampa.Player.play(video);
                Lampa.Player.playlist([video]);
            };

            if(items.length > 1) {
                Lampa.Select.show({
                    title: 'Выберите источник',
                    items: items,
                    onSelect: function(a) {
                        playVideo(a.url);
                    }
                });
            } else {
                playVideo(items[0].url);
            }
        };

        return comp;
    }

    // --- Интеграция в настройки Lampa ---
    function addSettings() {
        Lampa.Settings.listener.follow('open', function (e) {
            if (e.name == 'dunhua_settings') {
                var body = e.body;
                
                var createItem = function(name, key, def) {
                    var item = Lampa.Template.get('settings_param', {
                        name: name,
                        value: DB.get(key, def),
                        descr: key === 'proxy' ? 'Если не грузит, меняйте прокси' : ''
                    });
                    
                    item.on('hover:enter', function() {
                        Lampa.Input.edit({
                            title: name,
                            value: DB.get(key, def),
                            free: true
                        }, function(newVal) {
                            DB.set(key, newVal);
                            item.find('.settings-param__value').text(newVal);
                        });
                    });
                    
                    body.find('.settings-param__body').append(item);
                };

                createItem('CORS Прокси', 'proxy', Manifest.proxy);
                
                // Чекбокс
                var toggle = Lampa.Template.get('settings_param', {
                     name: 'Использовать прокси',
                     value: DB.get('use_proxy', true) ? 'Да' : 'Нет'
                });
                toggle.on('hover:enter', function(){
                    var state = !DB.get('use_proxy', true);
                    DB.set('use_proxy', state);
                    toggle.find('.settings-param__value').text(state ? 'Да' : 'Нет');
                });
                body.find('.settings-param__body').append(toggle);
            }
        });
    }

    // --- Инициализация ---
    if (!window.plugin_dunhua_ready) {
        window.plugin_dunhua_ready = true;
        
        // Регистрация компонентов
        Lampa.Component.add('dunhuatv', DunhuaComponent);
        Lampa.Component.add('dunhua_full', DunhuaFull);

        // Добавление кнопки в боковое меню
        Lampa.Listener.follow('app', function (e) {
            if (e.type == 'ready') {
                var ico = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1" /></svg>';
                
                var item = Lampa.Template.get('activity_menu_item', {
                    title: 'Dunhua', // Отображаемое имя
                    icon: ico
                });

                item.on('hover:enter', function () {
                    Lampa.Activity.push({
                        url: '',
                        title: 'DunhuaTV',
                        component: 'dunhuatv',
                        page: 1
                    });
                });

                $('.activity__menu .activity__menu-list').append(item);
                
                // Добавляем пункт в настройки
                Lampa.Settings.main().update(); // Обновляем чтобы сбросить кеш
                $('.settings__param').eq(0).after(Lampa.Template.get('settings_param', {
                    name: 'Настройки DunhuaTV',
                    component: 'dunhua_settings',
                    icon: ico
                }));
            }
        });
        
        addSettings();
        console.log('DunhuaTV Plugin loaded!');
    }

})();
