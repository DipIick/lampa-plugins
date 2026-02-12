(function () {
    'use strict';

    if (window.dunhuatv_plugin) return;
    window.dunhuatv_plugin = true;

    var site_url = 'https://dunhuatv.ru';

    // Хранилище настроек
    var DunhuaStorage = {
        get: function (name) { return Lampa.Storage.get('dunhuatv_' + name, ''); },
        set: function (name, value) { Lampa.Storage.set('dunhuatv_' + name, value); }
    };

    // Генератор ID для истории Lampa
    function generateId(url) {
        var hash = 0;
        if (!url || url.length === 0) return hash;
        for (var i = 0; i < url.length; i++) {
            hash = ((hash << 5) - hash) + url.charCodeAt(i);
            hash |= 0; 
        }
        return Math.abs(hash);
    }

    // --- СИСТЕМА УМНЫХ ЗАПРОСОВ (Как в популярных плагинах) ---
    // Пробуем прямой запрос (работает в Android APK), если ошибка - переключаемся на прокси (для Web)
    function fetchContent(path, onSuccess, onError) {
        var network = new Lampa.Reguest();
        var url = site_url + path;
        
        var custom_proxy = DunhuaStorage.get('proxy');
        
        // Список прокси (Cloudflare workers обычно стабильнее всего)
        var proxies = custom_proxy ? [custom_proxy] : [
            'https://corsproxy.io/?',
            'https://api.allorigins.win/get?url=', // /get отдает надежный JSON
            'https://cors.ygg.workers.dev/?'
        ];

        // 1. Попытка прямого запроса (Без прокси)
        console.log('[DunhuaTV] Try Direct:', url);
        network.silent(url, function(html) {
            console.log('[DunhuaTV] Direct success!');
            onSuccess(html);
        }, function() {
            console.log('[DunhuaTV] Direct failed (CORS). Trying proxies...');
            tryProxies(0);
        }, false, { dataType: 'text', timeout: 5000 });

        // 2. Перебор прокси
        function tryProxies(index) {
            if (index >= proxies.length) {
                if (onError) onError('Все прокси недоступны');
                return;
            }

            var proxy = proxies[index];
            var fetch_url = proxy + encodeURIComponent(url);
            if (proxy.indexOf('corsproxy.io') > -1 || proxy.indexOf('workers.dev') > -1) {
                fetch_url = proxy + url; // Этим прокси нужен не эскодированный URL
            }

            console.log('[DunhuaTV] Try Proxy (' + index + '):', fetch_url);

            network.silent(fetch_url, function(response) {
                var html = response;
                // Обработка allorigins JSON формата
                try {
                    var json = JSON.parse(response);
                    if (json.contents) html = json.contents;
                } catch (e) {}

                // Проверка на капчу Cloudflare
                if (html && (html.indexOf('<title>Just a moment...</title>') > -1 || html.indexOf('Cloudflare') > -1)) {
                    console.log('[DunhuaTV] Proxy ' + index + ' blocked by Cloudflare.');
                    tryProxies(index + 1);
                } else if (html && html.length > 1000) {
                    onSuccess(html);
                } else {
                    tryProxies(index + 1);
                }
            }, function() {
                tryProxies(index + 1);
            }, false, { dataType: 'text', timeout: 8000 });
        }
    }

    // --- ПАРСЕР DLE (Основан на точных селекторах со скриншота) ---
    var Parser = {
        getCards: function(html) {
            var doc = (new DOMParser()).parseFromString(html, "text/html");
            var cards = [];

            // Ищем карточки. На скрине: class="item-poster grid-items__item d-block expand-link"
            var elements = $(doc).find('.item-poster, .grid-items__item, .custom-item, .shortstory');
            
            // Запасной план: просто все блоки с картинками в основном контенте
            if (elements.length === 0) {
                elements = $(doc).find('#dle-content > div, .sect__content > div');
            }

            elements.each(function () {
                var el = $(this);
                
                // 1. Ссылка и название (На скрине: class="item__title ...")
                // Обратите внимание: ДВА подчеркивания __
                var linkEl = el.find('a.item__title, a.item_title, .title a, h2 a').first();
                if (linkEl.length === 0) linkEl = el.find('a').first(); // fallback
                
                var link = linkEl.attr('href');
                var title = linkEl.text().trim() || linkEl.attr('title') || 'Без названия';

                // 2. Постер (На скрине: class="item__img img-block ...")
                var img = '';
                var imgBlock = el.find('.item__img, .img-block, .image-box');
                
                // Парсим background-image из style="..."
                var style = imgBlock.attr('style');
                if (style && style.indexOf('url(') > -1) {
                    var match = style.match(/url\(['"]?(.*?)['"]?\)/);
                    if (match) img = match[1].replace(/&quot;/g, '');
                }

                if (!img) {
                    img = el.find('img').first().attr('src') || el.find('img').first().attr('data-src');
                }

                // 3. Мета (качество, серии)
                var quality = el.find('.quality, .ribbon-quality, .item__meta').text().trim().replace(/\s+/g, ' ') || ''; 

                if (link && link.indexOf('/user/') === -1) { // Игнорируем профили
                    // Фикс относительных путей
                    if (link.indexOf('http') === -1) link = site_url + (link.indexOf('/') === 0 ? '' : '/') + link;
                    if (img && img.indexOf('http') === -1) img = site_url + (img.indexOf('/') === 0 ? '' : '/') + img;
                    if (!img) img = './img/img_broken.svg';

                    cards.push({
                        title: title,
                        img: img,
                        url: link,
                        quality: quality.substring(0, 20), // Ограничиваем длину
                        original: el
                    });
                }
            });

            // Очистка от дублей
            return cards.filter(function(v, i, a) {
                return a.findIndex(function(t) { return (t.url === v.url) }) === i;
            });
        }
    };

    // --- ИНТЕРФЕЙС ПЛАГИНА ---
    function DunhuaTV(object) {
        var component = new Lampa.Component();
        var scroll;
        var items = [];
        var page = 1;
        var search_query = '';
        var search_mode = false;

        this.create = function () {
            var _this = this;
            this.activity.target = Lampa.Template.get('activity_search');
            this.activity.target.find('.search__source').text('Дунхуа ТВ');
            this.activity.target.find('.search__input').attr('placeholder', 'Поиск аниме...');
            this.activity.target.find('.search__keyboard').hide(); // Скрываем клаву при старте

            scroll = this.activity.target.find('.search__results');

            // Поиск по Enter
            this.activity.target.find('.search__input').on('keydown', function (e) {
                if (e.keyCode === 13) {
                    search_query = $(this).val();
                    _this.startSearch(search_query);
                }
            });
            this.activity.target.find('.search__button').on('click', function(){
                _this.startSearch(_this.activity.target.find('.search__input').val());
            });

            // Верхнее меню
            var controls = $('<div class="dunhuatv-controls layer--height"></div>');
            
            var btn_main = $('<div class="selector search__filter-button" style="margin-right:10px;">Главная</div>');
            btn_main.on('hover:enter', function () { _this.reset(); });

            var btn_fav = $('<div class="selector search__filter-button" style="margin-right:10px;">Избранное</div>');
            btn_fav.on('hover:enter', function () { _this.openFavorites(); });

            var btn_set = $('<div class="selector search__filter-button">Настройки</div>');
            btn_set.on('hover:enter', function () { _this.openSettings(); });

            controls.append(btn_main).append(btn_fav).append(btn_set);
            this.activity.target.find('.search__head').append(controls);

            return this.activity.target;
        };

        this.start = function () {
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
            search_query = '';
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
            this.load();
        };

        this.load = function () {
            var _this = this;
            this.loading(true);

            var path = '/';
            if (search_mode && search_query) {
                 path = '/index.php?do=search&subaction=search&story=' + encodeURIComponent(search_query) + (page > 1 ? '&search_start=' + page : '');
            } else if (page > 1) {
                path = '/page/' + page + '/';
            }

            fetchContent(path, function(html){
                _this.loading(false);
                var cards = Parser.getCards(html);
                if (cards.length > 0) {
                    _this.append(cards);
                    page++;
                } else if (page === 1) {
                    _this.empty('На странице пусто или парсер не нашел карточки.');
                }
            }, function(err){
                _this.loading(false);
                _this.empty('Ошибка: ' + err);
                Lampa.Noty.show('Не удалось получить данные сайта');
            });
        };

        this.append = function (data) {
            var _this = this;
            data.forEach(function (element) {
                var card = Lampa.Template.get('card', {
                    title: element.title,
                    release_year: '' // Скрываем стандартный год
                });
                card.addClass('card--collection');
                
                if(element.quality) {
                    card.find('.card__view').append('<div style="position:absolute; top:5px; left:5px; background:rgba(224,164,36,0.9); color:#000; padding:2px 6px; border-radius:4px; font-size:0.7em; font-weight:bold;">'+element.quality+'</div>');
                }

                var img = card.find('.card__img')[0];
                img.onload = function () { card.addClass('card--loaded'); };
                img.onerror = function () { img.src = './img/img_broken.svg'; };
                img.src = element.img;

                card.on('hover:focus', function () {
                    if(element.img && element.img.indexOf('broken') === -1) Lampa.Background.change(element.img);
                });

                card.on('hover:enter', function () {
                    _this.showMenu(element);
                });

                scroll.append(card);
                items.push(card);
            });
        };

        this.showMenu = function (element) {
            var _this = this;
            var isFav = DunhuaStorage.get('favs') && DunhuaStorage.get('favs').some(function(f){ return f.url === element.url; });
            
            Lampa.Select.show({
                title: element.title,
                items: [
                    { title: 'Смотреть', mark: true, action: function () { _this.openVideo(element.url, element.title); } },
                    { title: isFav ? 'Убрать из избранного' : 'В избранное', action: function () { _this.toggleFavorite(element); } },
                    { title: 'Очистить фон', action: function() { Lampa.Background.immediately(''); } }
                ],
                onSelect: function (a) { a.action(); }
            });
        };

        // --- ПАРСЕР ВИДЕО ---
        this.openVideo = function (url, title) {
            var _this = this;
            Lampa.Loading.start(function () { Lampa.Loading.stop(); });

            var path = url.replace(site_url, '');
            if(path.indexOf('http') === 0) path = url; 
            
            fetchContent(path, function (html) {
                Lampa.Loading.stop();
                var doc = (new DOMParser()).parseFromString(html, "text/html");
                var sources = [];

                // 1. Ищем табы DLE (Озвучки)
                var tabs_titles = [];
                $(doc).find('.tabs .tab, .xf_playlists li, .nav-tabs li').each(function(){
                    tabs_titles.push($(this).text().trim());
                });

                var tabs_content = $(doc).find('.tabs_content, .tab-content .tab-pane, .xf_playlists_content .box');
                if(tabs_content.length > 0) {
                     tabs_content.each(function(index){
                         var name = tabs_titles[index] || ('Источник ' + (index + 1));
                         var frame = $(this).find('iframe').attr('src') || $(this).find('iframe').attr('data-src');
                         if(frame) sources.push({ title: name, url: frame });
                     });
                }

                // 2. Ищем iframe напрямую
                if (sources.length === 0) {
                    $(doc).find('iframe').each(function(){
                        var src = $(this).attr('src') || $(this).attr('data-src');
                        if(src && src.indexOf('dunhuatv.ru') === -1 && src.indexOf('yandex') === -1) {
                             var name = 'Плеер ' + (sources.length + 1);
                             if(src.indexOf('kodik') > -1) name = 'Kodik';
                             if(src.indexOf('sibnet') > -1) name = 'Sibnet';
                             sources.push({ title: name, url: src });
                        }
                    });
                }

                // 3. Поиск регуляркой (Фоллбэк для скриптов)
                if (sources.length === 0) {
                    var match;
                    var regex = /<iframe[^>]+src=['"]([^'"]+)['"]/gi;
                    while ((match = regex.exec(html)) !== null) {
                        if (match[1].indexOf('dunhuatv.ru') === -1 && match[1].indexOf('metrika') === -1) {
                            sources.push({ title: 'Найден плеер', url: match[1] });
                        }
                    }
                }

                if (sources.length > 0) {
                    // Чистим дубли
                    var unique = [];
                    sources.forEach(function(s){
                        if(!unique.find(function(u){ return u.url === s.url })) unique.push(s);
                    });
                    _this.play(unique, title, url);
                } else {
                    Lampa.Noty.show('Плеер не найден на странице');
                }

            }, function () {
                Lampa.Loading.stop();
                Lampa.Noty.show('Ошибка загрузки страницы плеера');
            });
        };

        this.play = function (links, title, page_url) {
            var startPlayer = function(link_obj) {
                var video_url = link_obj.url;
                if(video_url.indexOf('http') === -1) video_url = 'https:' + video_url;

                var video = {
                    title: title,
                    url: video_url,
                    id: generateId(page_url), 
                    source: 'dunhuatv',
                    timeline: { title: title, hash: generateId(page_url) }
                };

                Lampa.Player.play(video);
                var history = new Lampa.History();
                history.add(video);
            };

            if(links.length === 1){
                 startPlayer(links[0]);
            } else {
                Lampa.Select.show({
                    title: 'Выбор озвучки/плеера',
                    items: links.map(function(l){
                        l.action = function(){ startPlayer(l); };
                        return l;
                    }),
                    onSelect: function(a){ a.action(); }
                });
            }
        };

        this.openFavorites = function () {
            scroll.empty();
            items = [];
            var favs = DunhuaStorage.get('favs');
            if (favs && favs.length > 0) this.append(favs);
            else this.empty('Список избранного пуст');
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
                Lampa.Noty.show('Настройки сохранены');
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

    // --- РЕГИСТРАЦИЯ ПЛАГИНА ---
    function startPlugin() {
        window.plugin_dunhuatv_ready = true;
        Lampa.Component.add('dunhuatv', DunhuaTV);

        // Добавляем кнопку в меню
        var svg_icon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        var button = $('<li class="menu__item selector" data-action="dunhua"><div class="menu__ico">' + svg_icon + '</div><div class="menu__text">Дунхуа ТВ</div></li>');

        button.on('hover:enter', function () {
            Lampa.Activity.push({ url: '', title: 'Дунхуа ТВ', component: 'dunhuatv', page: 1 });
        });

        $('.menu .menu__list').eq(0).append(button);
    }

    if (window.appready) startPlugin();
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') startPlugin();
        });
    }

})();
