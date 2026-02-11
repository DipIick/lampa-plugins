(function () {
    'use strict';

    // Проверка на повторную инициализацию
    if (window.dunhuatv_plugin) return;
    window.dunhuatv_plugin = true;

    // --- КОНФИГУРАЦИЯ ---
    // corsproxy.io часто работает стабильнее для DLE сайтов
    var default_proxy = 'https://corsproxy.io/?'; 
    
    // Список зеркал (основной + резервные)
    var mirrors = [
        'https://dunhuatv.ru',
        'https://www.dunhuatv.ru' 
    ];
    var current_mirror_index = 0;

    // --- ХРАНИЛИЩЕ ---
    var DunhuaStorage = {
        get: function (name) {
            return Lampa.Storage.get('dunhuatv_' + name, '');
        },
        set: function (name, value) {
            Lampa.Storage.set('dunhuatv_' + name, value);
        },
        field: function (name) {
            return Lampa.Storage.field('dunhuatv_' + name);
        }
    };

    // --- УТИЛИТЫ ---
    function generateId(url) {
        var hash = 0, i, chr;
        if (url.length === 0) return hash;
        for (i = 0; i < url.length; i++) {
            chr = url.charCodeAt(i);
            hash = ((hash << 5) - hash) + chr;
            hash |= 0; 
        }
        return Math.abs(hash);
    }

    // Обертка для запросов
    function smartRequest(path, callback, error_callback) {
        var network = new Lampa.Reguest();
        var proxy = DunhuaStorage.get('proxy') || default_proxy;
        
        var base_url = mirrors[current_mirror_index];
        var final_url = base_url + path;
        var fetch_url = '';

        // Улучшенная логика формирования URL прокси
        if (proxy.indexOf('allorigins') > -1) {
            fetch_url = proxy + encodeURIComponent(final_url);
        } else if (proxy.indexOf('corsproxy.io') > -1) {
            fetch_url = proxy + final_url; // corsproxy.io обычно принимает URL "как есть" после ?
        } else if (proxy.slice(-1) === '=') {
            fetch_url = proxy + encodeURIComponent(final_url);
        } else if (proxy.slice(-1) === '/') {
            fetch_url = proxy + final_url;
        } else {
            fetch_url = proxy + '/' + final_url;
        }

        console.log('[DunhuaTV] Request:', fetch_url);

        network.silent(fetch_url, function(result){
            // Проверка, вернул ли прокси JSON вместо HTML (бывает у allorigins без raw)
            try {
                var json = JSON.parse(result);
                if (json.contents) result = json.contents;
            } catch (e) {
                // Это не JSON, значит чистый HTML, продолжаем
            }
            callback(result);
        }, function(a, c){
            console.log('[DunhuaTV] Request failed:', a);
            if(error_callback) error_callback(a, c);
        }, false, {
            dataType: 'text'
        });
    }

    // --- ПАРСЕР ---
    var Parser = {
        getCards: function(html) {
            var doc = (new DOMParser()).parseFromString(html, "text/html");
            var cards = [];
            var site_url = mirrors[current_mirror_index];

            // 1. Проверка на Cloudflare/защиту
            var pageTitle = $(doc).find('title').text();
            if (pageTitle.includes('Cloudflare') || pageTitle.includes('DDOS-GUARD') || pageTitle.includes('Just a moment')) {
                Lampa.Noty.show('Сайт защищен. Смените прокси.');
                return [];
            }

            // 2. Сбор элементов (АГРЕССИВНЫЙ ПОИСК)
            // Сначала пробуем известные классы
            var elements = $(doc).find('.custom-item, .shortstory, .movie-item, .th-item, .item, .short, .post, .owl-item, .card');
            
            // Если ничего не нашли по классам, ищем внутри контентного блока любые div, у которых есть ссылка и картинка
            if(elements.length === 0) {
                 elements = $(doc).find('#dle-content div, #main div, .content div').filter(function() {
                     return $(this).find('a').length > 0 && ($(this).find('img').length > 0 || $(this).find('[style*="background-image"]').length > 0);
                 });
                 // Фильтруем, чтобы не брать слишком мелкие элементы или обертки
                 elements = elements.filter(function(){ return $(this).find('a').attr('href') && $(this).find('a').attr('href').length > 5 });
            }

            console.log('[DunhuaTV] Found elements:', elements.length);

            elements.each(function () {
                var el = $(this);
                
                // Ссылки: ищем первую попавшуюся
                var linkEl = el.find('a').first();
                // Приоритет заголовкам
                if (el.find('h2 a, h3 a, .title a, .name a').length > 0) {
                    linkEl = el.find('h2 a, h3 a, .title a, .name a').first();
                }

                var link = linkEl.attr('href');

                // Картинки: img src или data-src
                var imgEl = el.find('img').first();
                var img = imgEl.attr('src') || imgEl.attr('data-src') || imgEl.attr('data-original');
                
                // Названия
                var title = el.find('.custom-item-title, .short-title, h2, h3, .title, .ntitle, .th-title, .name').text().trim();
                
                // Если заголовка нет, пробуем взять из alt картинки или title ссылки
                if (!title) title = imgEl.attr('alt') || linkEl.attr('title');

                // Попытка найти картинку в стилях (background-image), если img тег пустой или это заглушка
                if (!img || img.indexOf('no_image') > -1) {
                    var style = el.find('[style*="background-image"]').attr('style') || el.attr('style');
                    if(style && style.match(/url\((.*?)\)/)){
                        var url_match = style.match(/url\((.*?)\)/)[1].replace(/['"]/g,'');
                        if(url_match) img = url_match;
                    }
                }

                // Доп инфо (не критично, если пусто)
                var quality = el.find('.quality, .ribbon-quality, .th-qual').text().trim() || ''; 
                var rating = el.find('.rating, .rate, .imdb, .th-rate').text().trim() || '';
                var status = el.find('.status, .date, .th-series').text().trim() || '';
                
                // Валидация и фикс путей
                if (link && title) {
                    // Фикс относительных путей
                    if (link.indexOf('http') === -1) {
                        if (link.indexOf('/') !== 0) link = '/' + link;
                        link = site_url + link;
                    }
                    
                    if (img) {
                        if (img.indexOf('http') === -1) {
                            if (img.indexOf('/') !== 0) img = '/' + img;
                            img = site_url + img;
                        }
                    } else {
                        img = './img/img_broken.svg'; // Заглушка, чтобы карточка всё равно создалась
                    }

                    // Исключаем системные ссылки (категории, юзеры, архивы)
                    if (link.indexOf('/user/') === -1 && link.indexOf('/tags/') === -1 && link.indexOf('/xfsearch/') === -1) {
                        cards.push({
                            title: title,
                            img: img,
                            url: link,
                            quality: quality,
                            rating: rating,
                            status: status,
                            original_element: el
                        });
                    }
                }
            });
            
            // Удаляем дубликаты (иногда парсер цепляет и обертку и внутренний блок)
            var uniqueCards = [];
            var seenUrls = new Set();
            cards.forEach(function(c){
                if(!seenUrls.has(c.url)){
                    seenUrls.add(c.url);
                    uniqueCards.push(c);
                }
            });
            
            return uniqueCards;
        }
    };


    // --- ОСНОВНОЙ КОМПОНЕНТ ---
    function DunhuaTV(object) {
        var component = new Lampa.Component();
        var item = Lampa.Template.get('items_line_card');
        var scroll;
        var items = [];
        var page = 1;
        var last_query = '';
        var search_mode = false;
        var active_request = false;

        this.create = function () {
            var _this = this;

            this.activity.target = Lampa.Template.get('activity_search');
            this.activity.target.find('.search__source').text('Дунхуа ТВ');
            this.activity.target.find('.search__input').attr('placeholder', 'Поиск аниме...');
            this.activity.target.find('.search__keyboard').hide();

            scroll = this.activity.target.find('.search__results');

            this.activity.target.find('.search__input').on('keydown', function (e) {
                if (e.keyCode == 13) {
                    last_query = $(this).val();
                    _this.startSearch(last_query);
                }
            });
            
            this.activity.target.find('.search__button').on('click', function(){
                var value = _this.activity.target.find('.search__input').val();
                _this.startSearch(value);
            });

            // Расширенная шапка
            var controls = $('<div class="dunhuatv-controls layer--height"></div>');
            
            var btn_fav = $('<div class="selector search__filter-button" style="margin-right:10px;">Избранное</div>');
            btn_fav.on('hover:enter', function () { _this.openFavorites(); });

            var btn_settings = $('<div class="selector search__filter-button">Настройки</div>');
            btn_settings.on('hover:enter', function () { _this.openSettings(); });
            
            var btn_reset = $('<div class="selector search__filter-button" style="margin-right:10px;">Главная</div>');
            btn_reset.on('hover:enter', function () { _this.reset(); });

            controls.append(btn_reset).append(btn_fav).append(btn_settings);
            this.activity.target.find('.search__head').append(controls);

            return this.activity.target;
        };

        this.start = function () {
            var _this = this;
            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll);
                    Lampa.Controller.collectionFocus(false, scroll);
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
                down: function () { if (Navigator.canmove('down')) Navigator.move('down'); },
                back: function () { Lampa.Activity.backward(); }
            });

            Lampa.Controller.toggle('content');
            this.load();
        };

        this.reset = function(){
            page = 1;
            items = [];
            search_mode = false;
            last_query = '';
            scroll.empty();
            this.activity.target.find('.search__input').val('');
            this.load();
        };

        this.startSearch = function(query){
            if(!query) return;
            page = 1;
            items = [];
            search_mode = true;
            scroll.empty();
            this.load(query);
        }

        this.load = function (query) {
            var _this = this;
            this.loading(true);
            active_request = true;

            var path = '';
            if(search_mode && query){
                 path = '/index.php?do=search&subaction=search&story=' + encodeURIComponent(query);
                 if(page > 1) path += '&search_start=' + page;
            } else {
                path = (page > 1 ? '/page/' + page + '/' : '/');
            }

            smartRequest(path, function(html){
                _this.loading(false);
                active_request = false;
                _this.parse(html);
            }, function(e){
                _this.loading(false);
                active_request = false;
                Lampa.Noty.show('Ошибка сети. Проверьте консоль и настройки Proxy.');
            });
        };

        this.parse = function (html) {
            var cards = Parser.getCards(html);
            
            if (cards.length > 0) {
                this.append(cards);
                page++;
            } else {
                if(page === 1) this.empty();
            }
        };

        this.append = function (data) {
            var _this = this;
            data.forEach(function (element) {
                var card = Lampa.Template.get('card', {
                    title: element.title,
                    release_year: element.status || ''
                });

                card.addClass('card--collection');
                
                // --- VISUAL: BADGES ---
                if(element.quality) {
                    card.find('.card__view').append('<div class="card__quality" style="position:absolute; top:5px; left:5px; background:#e0a424; color:#000; padding:2px 5px; border-radius:3px; font-size:0.7em; font-weight:bold;">'+element.quality+'</div>');
                }
                if(element.rating) {
                    card.find('.card__view').append('<div class="card__type" style="position:absolute; top:5px; right:5px; background:rgba(0,0,0,0.7); padding:2px 5px; border-radius:3px;">'+element.rating+'</div>');
                }

                // Изображение
                var img = card.find('.card__img')[0];
                img.onload = function () { card.addClass('card--loaded'); };
                img.onerror = function () { img.src = './img/img_broken.svg'; };
                img.src = element.img;

                // --- INTERACTION: FOCUS BACKDROP ---
                card.on('hover:focus', function () {
                    if(element.img) Lampa.Background.change(element.img);
                });

                // --- INTERACTION: ACTIONS ---
                card.on('hover:enter', function () {
                    _this.showMenu(element);
                });

                // --- UX: CONTEXT MENU (Long Press) ---
                card.on('hover:long', function () {
                    Lampa.ContextMenu.show({
                        item: Lampa.Template.get('items_line_card', element), 
                        onSelect: function (a) {
                           _this.showMenu(element);
                        }
                    });
                });

                scroll.append(card);
                items.push(card);
            });
        };

        this.showMenu = function (element) {
            var _this = this;
            var menu = [
                {
                    title: 'Смотреть',
                    mark: true,
                    action: function () {
                        _this.parseVideo(element.url, element.title);
                    }
                },
                {
                    title: this.isFavorite(element) ? 'Убрать из избранного' : 'В избранное',
                    action: function () {
                        _this.toggleFavorite(element);
                    }
                },
                {
                    title: 'Очистить фон',
                    action: function() {
                         Lampa.Background.immediately('');
                    }
                }
            ];

            Lampa.Select.show({
                title: element.title,
                items: menu,
                onSelect: function (a) {
                    a.action();
                }
            });
        };

        // --- УЛУЧШЕННЫЙ ПАРСЕР ВИДЕО ---
        this.parseVideo = function (url, title) {
            var _this = this;
            Lampa.Loading.start(function () { Lampa.Loading.stop(); });

            var path = url.replace(mirrors[current_mirror_index], '');
            var proxy = DunhuaStorage.get('proxy') || default_proxy;
            // Чистим path от прокси
            if(path.indexOf(proxy) === 0) path = path.replace(proxy, '');
            // Чистим от протоколов, если остались
            if(path.indexOf('http') === 0 && path.indexOf(mirrors[current_mirror_index]) > -1) {
                 path = path.replace(mirrors[current_mirror_index], '');
            }

            
            smartRequest(path, function (html) {
                Lampa.Loading.stop();
                var doc = (new DOMParser()).parseFromString(html, "text/html");
                var sources = [];

                // 1. Поиск плейлистов в табах
                var tabs_titles = [];
                $(doc).find('.tabs .tab, .xf_playlists li, .nav-tabs li, .kino-lines li').each(function(){
                    tabs_titles.push($(this).text().trim());
                });

                var tabs_content = $(doc).find('.tabs_content, .tab-content .tab-pane, .xf_playlists_content .box, .kino-lines .kino-box');
                
                if(tabs_content.length > 0) {
                     tabs_content.each(function(index){
                         var name = tabs_titles[index] || ('Источник ' + (index + 1));
                         var frame = $(this).find('iframe').attr('src') || $(this).find('iframe').attr('data-src');
                         if(frame) {
                             sources.push({ title: name, url: frame });
                         }
                     });
                }

                // 2. Если табы не найдены, ищем просто iframe
                if (sources.length === 0) {
                    $(doc).find('iframe').each(function(){
                        var src = $(this).attr('src') || $(this).attr('data-src');
                        if(src) {
                             var name = 'Основной плеер';
                             if(src.indexOf('kodik') > -1) name = 'Kodik';
                             if(src.indexOf('sibnet') > -1) name = 'Sibnet';
                             sources.push({ title: name, url: src });
                        }
                    });
                }

                if (sources.length > 0) {
                    _this.play(sources, title, url);
                } else {
                    Lampa.Noty.show('Видео не найдено на странице');
                }

            }, function () {
                Lampa.Loading.stop();
                Lampa.Noty.show('Ошибка загрузки страницы');
            });
        };

        this.play = function (links, title, page_url) {
            var _this = this;
            
            var startPlayer = function(link_obj) {
                var video_url = link_obj.url;
                if(video_url.indexOf('http') === -1) video_url = 'https:' + video_url;

                var video = {
                    title: title,
                    url: video_url,
                    id: generateId(page_url), 
                    source: 'dunhuatv',
                    season: 1, 
                    episode: 1, 
                    timeline: {
                        title: title,
                        hash: generateId(page_url) 
                    }
                };

                Lampa.Player.play(video);
                
                var history = new Lampa.History();
                history.add(video);
            };

            if(links.length === 1){
                 startPlayer(links[0]);
            } else {
                Lampa.Select.show({
                    title: 'Выбор источника',
                    items: links.map(function(l){
                        l.action = function(){ startPlayer(l); };
                        return l;
                    }),
                    onSelect: function(a){
                        a.action();
                    }
                });
            }
        };


        // --- ИЗБРАННОЕ ---
        this.openFavorites = function () {
            scroll.empty();
            items = [];
            var favs = DunhuaStorage.get('favs');
            if (favs) {
                this.append(favs);
            } else {
                this.empty('Список избранного пуст');
            }
        };

        this.isFavorite = function (element) {
            var favs = DunhuaStorage.get('favs') || [];
            return favs.some(function (f) { return f.url === element.url; });
        };

        this.toggleFavorite = function (element) {
            var favs = DunhuaStorage.get('favs') || [];
            var exists = favs.findIndex(function (f) { return f.url === element.url; });

            if (exists !== -1) {
                favs.splice(exists, 1);
                Lampa.Noty.show('Удалено из избранного');
            } else {
                favs.push(element);
                Lampa.Noty.show('Добавлено в избранное');
            }
            DunhuaStorage.set('favs', favs);
        };

        // --- НАСТРОЙКИ ---
        this.openSettings = function () {
            Lampa.Input.edit({
                title: 'Настройка Proxy',
                value: DunhuaStorage.get('proxy') || default_proxy,
                free: true,
                nosave: true
            }, function (new_proxy) {
                DunhuaStorage.set('proxy', new_proxy);
                Lampa.Noty.show('Proxy сохранен.');
            });
        };

        this.loading = function (status) {
            if (status) this.activity.loader(true);
            else this.activity.loader(false);
        };

        this.empty = function (msg) {
            scroll.append(Lampa.Template.get('empty', {
                title: msg || 'Пусто',
                descr: 'Ничего не найдено (или ошибка парсинга)'
            }));
        };

        this.destroy = function () {
            scroll.empty();
            items = [];
        };
    }

    // --- ИНИЦИАЛИЗАЦИЯ ---
    function startPlugin() {
        window.plugin_dunhuatv_ready = true;
        Lampa.Component.add('dunhuatv', DunhuaTV);

        var button = $('<li class="menu__item selector" data-action="dunhua"><div class="menu__ico"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div><div class="menu__text">Дунхуа</div></li>');

        button.on('hover:enter', function () {
            Lampa.Activity.push({
                url: '',
                title: 'Дунхуа ТВ',
                component: 'dunhuatv',
                page: 1
            });
        });

        $('.menu .menu__list').eq(0).append(button);

        Lampa.Search.addSource({
            title: 'Дунхуа ТВ',
            search: function(query, callback) {
                 var path = '/index.php?do=search&subaction=search&story=' + encodeURIComponent(query);
                 smartRequest(path, function(html){
                     var cards = Parser.getCards(html);
                     var results = cards.map(function(card){
                         card.type = 'anime';
                         return card;
                     });
                     callback(results);
                 }, function(){
                     callback([]);
                 });
            }
        });
    }

    if (window.appready) startPlugin();
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type == 'ready') startPlugin();
        });
    }

})();
