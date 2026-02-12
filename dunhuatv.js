(function () {
    'use strict';

    if (window.dunhuatv_plugin) return;
    window.dunhuatv_plugin = true;

    // Список зеркал сайта
    var mirrors = [
        'https://dunhuatv.ru',
        'https://www.dunhuatv.ru' 
    ];
    var current_mirror_index = 0;

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

    // Умный запрос с авто-перебором прокси (Auto-Rotation)
    function smartRequest(path, callback, error_callback) {
        var network = new Lampa.Reguest();
        var base_url = mirrors[current_mirror_index];
        var final_url = base_url + path;

        // Встроенный пул прокси
        var proxies = [
            'https://corsproxy.io/?',
            'https://api.allorigins.win/raw?url=',
            'https://cors.zmov.ru/?',
            'https://cors.appitems.ru/?'
        ];

        // Если пользователь указал свой прокси в настройках, ставим его первым
        var custom_proxy = DunhuaStorage.get('proxy');
        if (custom_proxy) {
            proxies.unshift(custom_proxy);
        }

        function tryProxy(index) {
            if (index >= proxies.length) {
                console.log('[DunhuaTV] All proxies failed.');
                if (error_callback) error_callback('All proxies failed');
                return;
            }

            var proxy = proxies[index];
            var fetch_url = proxy + (proxy.slice(-1) === '=' ? encodeURIComponent(final_url) : final_url);

            console.log('[DunhuaTV] Trying proxy:', fetch_url);

            network.silent(fetch_url, function(result){
                // Проверяем, не подсунул ли прокси JSON (allorigins без raw)
                try {
                    var json = JSON.parse(result);
                    if (json.contents) result = json.contents;
                } catch (e) {}

                // Проверка на заглушки защиты (Cloudflare / DDOS-GUARD)
                if (!result || result.indexOf('Cloudflare') > -1 || result.indexOf('Just a moment') > -1 || result.indexOf('DDOS-GUARD') > -1) {
                    console.log('[DunhuaTV] Blocked by CF/DDoS on proxy ' + index + '. Switching...');
                    tryProxy(index + 1);
                } else {
                    // Успешно!
                    callback(result);
                }
            }, function(a, c){
                console.log('[DunhuaTV] Network error on proxy ' + index + '. Switching...');
                tryProxy(index + 1);
            }, false, {
                dataType: 'text',
                timeout: 10000 // таймаут 10 сек на каждый прокси
            });
        }

        tryProxy(0);
    }

    var Parser = {
        getCards: function(html) {
            var doc = (new DOMParser()).parseFromString(html, "text/html");
            var cards = [];
            var site_url = mirrors[current_mirror_index];

            // Основной поиск по структуре со скриншота (div.item-poster или .grid-items__item)
            var elements = $(doc).find('div.item-poster, .grid-items_item, .grid-items__item');

            // Резервный поиск, если классы изменились
            if(elements.length === 0) {
                 elements = $(doc).find('.custom-item, .shortstory, #dle-content > div.item');
            }

            console.log('[DunhuaTV] Found elements:', elements.length);

            elements.each(function () {
                var el = $(this);
                
                // 1. Ссылка и Заголовок
                var linkEl = el.find('a.item_title, .item_title a, h2 a');
                if (linkEl.length === 0) {
                    // Ищем любую ссылку, которая не является картинкой
                    linkEl = el.find('a').not('.img-block, .item-poster');
                }

                var link = linkEl.first().attr('href');
                var title = linkEl.first().text().trim() || linkEl.first().attr('title');

                if (!link) return; // Пропускаем кривые элементы

                // 2. Картинка (Парсинг background-image со скрина)
                var img = '';
                var imgBlock = el.find('a.img-block, div.img-block, .item-poster.img-block, .image-box');
                
                var style = imgBlock.attr('style') || el.attr('style');
                if (style && style.indexOf('url(') > -1) {
                    var match = style.match(/url\(['"]?(.*?)['"]?\)/);
                    if (match) img = match[1].replace(/&quot;/g, '');
                }

                // Резервный поиск через тег img
                if (!img) {
                    var imgTag = el.find('img').first();
                    img = imgTag.attr('src') || imgTag.attr('data-src');
                }
                
                // 3. Мета-информация
                var quality = el.find('.quality, .ribbon-quality').text().trim() || ''; 
                var rating = el.find('.rating, .rate, .item_meta .fa-star').parent().text().trim() || '';
                var status = el.find('.status, .date, .item_meta').text().trim() || '';

                if (link && title) {
                    // Нормализация путей
                    if (link.indexOf('http') === -1) link = site_url + (link.indexOf('/') === 0 ? '' : '/') + link;
                    if (img) {
                        if (img.indexOf('http') === -1) img = site_url + (img.indexOf('/') === 0 ? '' : '/') + img;
                    } else {
                        img = './img/img_broken.svg';
                    }

                    // Исключаем мусор (теги, профили)
                    if (link.indexOf('/user/') === -1 && link.indexOf('/tags/') === -1) {
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
            
            // Фильтрация дубликатов по URL
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
                
                var cards = Parser.getCards(html);
                if (cards.length > 0) {
                    _this.append(cards);
                    page++;
                } else {
                    if (page === 1) {
                        // Выводим заголовок страницы для отладки, если карточки не найдены
                        var doc = (new DOMParser()).parseFromString(html, "text/html");
                        var debugTitle = $(doc).find('title').text() || 'Неизвестная ошибка парсинга';
                        _this.empty('Пусто. Заголовок сайта: ' + debugTitle);
                    }
                }
            }, function(e){
                _this.loading(false);
                active_request = false;
                _this.empty('Все прокси недоступны. Ошибка сети.');
                Lampa.Noty.show('Все прокси-сервера не ответили.');
            });
        };

        this.append = function (data) {
            var _this = this;
            data.forEach(function (element) {
                var card = Lampa.Template.get('card', {
                    title: element.title,
                    release_year: element.status || ''
                });

                card.addClass('card--collection');
                
                if(element.quality) {
                    card.find('.card__view').append('<div class="card__quality" style="position:absolute; top:5px; left:5px; background:#e0a424; color:#000; padding:2px 5px; border-radius:3px; font-size:0.7em; font-weight:bold;">'+element.quality+'</div>');
                }
                if(element.rating) {
                    card.find('.card__view').append('<div class="card__type" style="position:absolute; top:5px; right:5px; background:rgba(0,0,0,0.7); padding:2px 5px; border-radius:3px;">'+element.rating+'</div>');
                }

                var img = card.find('.card__img')[0];
                img.onload = function () { card.addClass('card--loaded'); };
                img.onerror = function () { img.src = './img/img_broken.svg'; };
                img.src = element.img;

                card.on('hover:focus', function () {
                    if(element.img) Lampa.Background.change(element.img);
                });

                card.on('hover:enter', function () {
                    _this.showMenu(element);
                });

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

        this.parseVideo = function (url, title) {
            var _this = this;
            Lampa.Loading.start(function () { Lampa.Loading.stop(); });

            var path = url.replace(mirrors[current_mirror_index], '');
            if(path.indexOf('http') === 0) path = url; // fallback
            
            smartRequest(path, function (html) {
                Lampa.Loading.stop();
                var doc = (new DOMParser()).parseFromString(html, "text/html");
                var sources = [];

                // 1. Ищем табы DLE (Озвучки / Сезоны)
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

                // 2. Ищем любые iframe на странице напрямую
                if (sources.length === 0) {
                    $(doc).find('iframe').each(function(){
                        var src = $(this).attr('src') || $(this).attr('data-src');
                        if(src && src.indexOf('dunhuatv.ru') === -1) { // исключаем локальные фреймы
                             var name = 'Плеер ' + (sources.length + 1);
                             if(src.indexOf('kodik') > -1) name = 'Kodik';
                             if(src.indexOf('sibnet') > -1) name = 'Sibnet';
                             if(src.indexOf('vk.com') > -1) name = 'VK Video';
                             sources.push({ title: name, url: src });
                        }
                    });
                }

                // 3. Глобальный поиск фреймов и ссылок регуляркой по всему HTML (супер-фоллбэк для JS-плееров)
                if (sources.length === 0) {
                    var iframeRegex = /<iframe[^>]+src=['"]([^'"]+)['"]/gi;
                    var match;
                    while ((match = iframeRegex.exec(html)) !== null) {
                        var src = match[1];
                        if (src.indexOf('dunhuatv.ru') === -1 && src.indexOf('yandex') === -1 && src.indexOf('google') === -1) {
                            sources.push({ title: 'Найден плеер (Regex)', url: src });
                        }
                    }
                }

                if (sources.length > 0) {
                    // Удаляем дубликаты
                    var uniqueSources = [];
                    var seenSrc = new Set();
                    sources.forEach(function(s){
                        if(!seenSrc.has(s.url)){
                            seenSrc.add(s.url);
                            uniqueSources.push(s);
                        }
                    });
                    
                    _this.play(uniqueSources, title, url);
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

        this.openSettings = function () {
            Lampa.Input.edit({
                title: 'Свой Proxy (оставьте пустым для авто-выбора)',
                value: DunhuaStorage.get('proxy') || '',
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
                descr: 'Ничего не найдено'
            }));
        };

        this.destroy = function () {
            scroll.empty();
            items = [];
        };
    }

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
