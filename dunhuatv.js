(function () {
    'use strict';

    if (window.dunhuatv_plugin) return;
    window.dunhuatv_plugin = true;

    var site_url = 'https://dunhuatv.ru';

    var DunhuaStorage = {
        get: function (name) { return Lampa.Storage.get('dunhuatv_' + name, ''); },
        set: function (name, value) { Lampa.Storage.set('dunhuatv_' + name, value); },
        field: function (name) { return Lampa.Storage.field('dunhuatv_' + name); }
    };

    function generateId(url) {
        var hash = 0;
        if (!url || url.length === 0) return hash;
        for (var i = 0; i < url.length; i++) {
            hash = ((hash << 5) - hash) + url.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash);
    }

    function fetchContent(path, onSuccess, onError) {
        var network = new Lampa.Reguest();
        var url = site_url + path;
        var custom_proxy = DunhuaStorage.get('proxy');
        
        var proxies = custom_proxy ? [custom_proxy] : [
            'https://api.codetabs.com/v1/proxy?quest=',
            'https://api.allorigins.win/get?url=',
            'https://thingproxy.freeboard.io/fetch/',
            'https://corsproxy.io/?'
        ];

        network.silent(url, function(html) {
            onSuccess(html);
        }, function() {
            tryProxies(0);
        }, false, { dataType: 'text', timeout: 5000 });

        function tryProxies(index) {
            if (index >= proxies.length) {
                if (onError) onError();
                return;
            }

            var proxy = proxies[index];
            var fetch_url = proxy + encodeURIComponent(url);
            
            if (proxy.indexOf('corsproxy.io') > -1 || proxy.indexOf('codetabs') > -1) {
                fetch_url = proxy + url;
            }

            network.silent(fetch_url, function(response) {
                var html = response;
                try {
                    var json = JSON.parse(response);
                    if (json.contents) html = json.contents;
                } catch (e) {}

                if (html && (html.indexOf('<title>Just a moment...</title>') > -1 || html.indexOf('Cloudflare') > -1)) {
                    tryProxies(index + 1);
                } else if (html && html.length > 500) {
                    onSuccess(html);
                } else {
                    tryProxies(index + 1);
                }
            }, function() {
                tryProxies(index + 1);
            }, false, { dataType: 'text', timeout: 8000 });
        }
    }

    var Parser = {
        getCards: function(html) {
            var doc = new DOMParser().parseFromString(html, "text/html");
            var cards = [];

            // Селекторы на основе скриншота 2 (.grid-items__item)
            var elements = $(doc).find('.grid-items__item, .item-poster, .shortstory');

            elements.each(function () {
                var el = $(this);
                
                // На скриншоте класс ссылки a.item_title
                var linkEl = el.find('.item_title, .item__title, a.item-link').first();
                if (linkEl.length === 0) linkEl = el.find('a').first();

                var link = linkEl.attr('href');
                var title = linkEl.text().trim() || linkEl.attr('title');

                // На скриншоте класс картинки div.item__img
                var img = '';
                var imgBlock = el.find('.item__img, .img-block');
                var style = imgBlock.attr('style'); 

                // Извлекаем из background-image
                if (style && style.indexOf('url') > -1) {
                    var match = style.match(/url\(['"]?(.*?)['"]?\)/);
                    if (match) img = match[1];
                }
                
                // Если нет стиля, ищем img тег
                if (!img) {
                    var imgTag = el.find('img').first();
                    img = imgTag.attr('data-src') || imgTag.attr('src');
                }

                // Доп инфо из скриншота: .item__meta, .status
                var label = el.find('.item_meta-label, .status, .date').text().trim();
                var quality = el.find('.quality, .ribbon-quality').text().trim();

                if (link && title) {
                    if (link.indexOf('http') === -1) link = site_url + (link.indexOf('/') === 0 ? '' : '/') + link;
                    if (img && img.indexOf('http') === -1) img = site_url + (img.indexOf('/') === 0 ? '' : '/') + img;
                    if (!img) img = './img/img_broken.svg';

                    cards.push({
                        title: title,
                        img: img,
                        url: link,
                        quality: quality,
                        status: label,
                        original: el
                    });
                }
            });

            return cards.filter(function(v, i, a) {
                return a.findIndex(function(t) { return (t.url === v.url); }) === i;
            });
        }
    };

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
            this.activity.target.find('.search__input').attr('placeholder', 'Поиск...');
            this.activity.target.find('.search__keyboard').hide();

            scroll = this.activity.target.find('.search__results');

            this.activity.target.find('.search__input').on('keydown', function (e) {
                if (e.keyCode === 13) {
                    search_query = $(this).val();
                    _this.startSearch(search_query);
                }
            });
            this.activity.target.find('.search__button').on('click', function(){
                _this.startSearch(_this.activity.target.find('.search__input').val());
            });

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
                    _this.empty('Пусто. Возможно защита сайта блокирует запрос.');
                }
            }, function(){
                _this.loading(false);
                _this.empty('Ошибка сети');
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
                
                if(element.quality) card.find('.card__view').append('<div style="position:absolute; top:5px; left:5px; background:rgba(224,164,36,0.9); color:#000; padding:2px 6px; border-radius:4px; font-size:0.7em; font-weight:bold;">'+element.quality+'</div>');

                var img = card.find('.card__img')[0];
                img.onload = function () { card.addClass('card--loaded'); };
                img.onerror = function () { img.src = './img/img_broken.svg'; };
                img.src = element.img;

                card.on('hover:focus', function () {
                    if(element.img && element.img.indexOf('broken') === -1) Lampa.Background.change(element.img);
                });
                card.on('hover:enter', function () { _this.showMenu(element); });
                card.on('hover:long', function () {
                    Lampa.ContextMenu.show({
                        item: Lampa.Template.get('items_line_card', element),
                        onSelect: function (a) { _this.showMenu(element); }
                    });
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

        this.openVideo = function (url, title) {
            var _this = this;
            Lampa.Loading.start(function () { Lampa.Loading.stop(); });
            var path = url.replace(site_url, '');
            if(path.indexOf('http') === 0) path = url; 
            
            fetchContent(path, function (html) {
                Lampa.Loading.stop();
                var doc = new DOMParser().parseFromString(html, "text/html");
                var sources = [];

                // Поиск iframe по всему документу
                $(doc).find('iframe').each(function(i){
                    var src = $(this).attr('src') || $(this).attr('data-src');
                    if(src && src.indexOf('yandex') === -1 && src.indexOf('metrika') === -1) {
                         var name = 'Источник ' + (i + 1);
                         if(src.indexOf('kodik') > -1) name = 'Kodik';
                         if(src.indexOf('sibnet') > -1) name = 'Sibnet';
                         if(src.indexOf('ashdi') > -1) name = 'Ashdi';
                         sources.push({ title: name, url: src });
                    }
                });

                if (sources.length > 0) {
                    var unique = [];
                    sources.forEach(function(s){
                        if(!unique.find(function(u){ return u.url === s.url; })) unique.push(s);
                    });
                    _this.play(unique, title, url);
                } else {
                    Lampa.Noty.show('Плеер не найден');
                }
            }, function () {
                Lampa.Loading.stop();
                Lampa.Noty.show('Ошибка загрузки');
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
                new Lampa.History().add(video);
            };
            if(links.length === 1) startPlayer(links[0]);
            else {
                Lampa.Select.show({
                    title: 'Выбор источника',
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
            else this.empty('Список пуст');
        };

        this.toggleFavorite = function (element) {
            var favs = DunhuaStorage.get('favs') || [];
            var exists = favs.findIndex(function (f) { return f.url === element.url; });
            if (exists !== -1) {
                favs.splice(exists, 1);
                Lampa.Noty.show('Удалено');
            } else {
                favs.push(element);
                Lampa.Noty.show('Добавлено');
            }
            DunhuaStorage.set('favs', favs);
        };

        this.openSettings = function () {
            Lampa.Input.edit({
                title: 'Свой Proxy',
                value: DunhuaStorage.get('proxy') || '',
                free: true,
                nosave: true
            }, function (new_proxy) {
                DunhuaStorage.set('proxy', new_proxy);
                Lampa.Noty.show('Сохранено');
            });
        };

        this.loading = function (status) {
            if (status) this.activity.loader(true);
            else this.activity.loader(false);
        };

        this.empty = function (msg) {
            scroll.append(Lampa.Template.get('empty', { title: msg }));
        };
    }

    function startPlugin() {
        window.plugin_dunhuatv_ready = true;
        Lampa.Component.add('dunhuatv', DunhuaTV);
        var svg_icon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        var button = $('<li class="menu__item selector" data-action="dunhua"><div class="menu__ico">' + svg_icon + '</div><div class="menu__text">Дунхуа ТВ</div></li>');
        button.on('hover:enter', function () {
            Lampa.Activity.push({ url: '', title: 'Дунхуа ТВ', component: 'dunhuatv', page: 1 });
        });
        $('.menu .menu__list').eq(0).append(button);
        
        Lampa.Search.addSource({
            title: 'Дунхуа ТВ',
            search: function(query, callback) {
                 var path = '/index.php?do=search&subaction=search&story=' + encodeURIComponent(query);
                 fetchContent(path, function(html){
                     var cards = Parser.getCards(html);
                     var results = cards.map(function(card){ card.type = 'anime'; return card; });
                     callback(results);
                 }, function(){ callback([]); });
            }
        });
    }

    if (window.appready) startPlugin();
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') startPlugin();
        });
    }
})();
