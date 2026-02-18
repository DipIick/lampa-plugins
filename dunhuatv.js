(function () {
    'use strict';

    if (window.pornhub_plugin) return;
    window.pornhub_plugin = true;

    var Manifest = {
        name: 'PornHub',
        version: '1.3.0',
        component: 'pornhub',
        site_url: 'https://www.pornhub.com'
    };

    var Storage = {
        get: function (name) {
            return Lampa.Storage.get('ph_' + name, '');
        },
        set: function (name, value) {
            Lampa.Storage.set('ph_' + name, value);
        }
    };

    var Network = {
        proxies: [
            'https://corsproxy.io/?',
            'https://api.codetabs.com/v1/proxy?quest=',
            'https://api.allorigins.win/get?url=',
            'https://thingproxy.freeboard.io/fetch/'
        ],
        
        request: function(path, onSuccess, onError) {
            var url = Manifest.site_url + path;
            var custom_proxy = Storage.get('proxy');
            var active_proxies = custom_proxy ? [custom_proxy].concat(this.proxies) : this.proxies;

            function tryProxy(index) {
                if (index >= active_proxies.length) {
                    if (onError) onError();
                    return;
                }

                var current_proxy = active_proxies[index];
                var fetch_url = '';

                if (current_proxy.indexOf('allorigins') > -1 || current_proxy.indexOf('codetabs') > -1) {
                    fetch_url = current_proxy + encodeURIComponent(url);
                } else {
                    fetch_url = current_proxy + url;
                }

                var network = new Lampa.Reguest();
                network.silent(fetch_url, function(response) {
                    var html = response;
                    
                    try {
                        var json = JSON.parse(response);
                        if (json.contents) html = json.contents;
                    } catch (e) {}

                    if (!html || html.length < 500 || html.indexOf('captcha') > -1 || html.indexOf('Access Denied') > -1 || html.indexOf('Cloudflare') > -1) {
                        tryProxy(index + 1);
                    } else {
                        onSuccess(html);
                    }
                }, function() {
                    tryProxy(index + 1);
                }, false, {
                    dataType: 'text',
                    timeout: 15000 
                });
            }

            tryProxy(0);
        }
    };

    var Parser = {
        getCards: function(html) {
            var cleanHtml = html.replace(/<img/g, '<noload').replace(/<script/g, '<noscript');
            var doc = $('<div>' + cleanHtml + '</div>');
            var cards = [];

            var elements = doc.find('li.pcVideoListItem, .videoBox, .video-wrapper, li.js-pop');

            elements.each(function () {
                var el = $(this);
                
                var titleNode = el.find('.thumbnail-info-wrapper .title a, .title a, a.title').first();
                if (titleNode.length === 0) titleNode = el.find('a').first();

                var link = titleNode.attr('href');
                var title = titleNode.text().trim() || titleNode.attr('title');

                var imgNode = el.find('.phimage noload, .thumb_image').first();
                var img = imgNode.attr('data-mediumthumb') || 
                          imgNode.attr('data-thumb_url') || 
                          imgNode.attr('data-src') || 
                          imgNode.attr('src');

                var duration = el.find('.duration').text().trim();
                var views = el.find('.views var').text().trim() || el.find('.views').text().trim();
                var rating = el.find('.value').text().trim();

                if (link && title && link.indexOf('view_video.php') > -1) {
                    if (link.indexOf('http') === -1) link = Manifest.site_url + link;
                    if (img && img.indexOf('http') === -1) img = Manifest.site_url + img;

                    cards.push({
                        title: title,
                        img: img || './img/img_broken.svg',
                        url: link,
                        subtitle: (duration ? duration + ' | ' : '') + views,
                        rating: rating,
                        original: el
                    });
                }
            });

            return cards;
        }
    };

    function PornHub(object) {
        var component = new Lampa.Component();
        var scroll;
        var items = [];
        var page = 1;
        var search_query = '';
        var search_mode = false;

        this.create = function () {
            var _this = this;
            
            this.activity.target = Lampa.Template.get('activity_search');
            this.activity.target.find('.search__source').text('PornHub');
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

            var controls = $('<div class="ph-controls layer--height"></div>');
            
            var btn_home = $('<div class="selector search__filter-button" style="margin-right:10px;">Главная</div>');
            btn_home.on('hover:enter', function () { _this.reset(); });

            var btn_settings = $('<div class="selector search__filter-button">Настройки</div>');
            btn_settings.on('hover:enter', function () { _this.openSettings(); });

            controls.append(btn_home).append(btn_settings);
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

        this.reset = function() {
            page = 1;
            items = [];
            search_mode = false;
            search_query = '';
            scroll.empty();
            this.activity.target.find('.search__input').val('');
            this.load();
        };

        this.startSearch = function(query) {
            if (!query) return;
            page = 1;
            items = [];
            search_mode = true;
            scroll.empty();
            this.load();
        };

        this.load = function () {
            var _this = this;
            this.loading(true);

            var path = '/video?o=mv';
            if (search_mode && search_query) {
                path = '/video/search?search=' + encodeURIComponent(search_query) + '&page=' + page;
            } else if (page > 1) {
                path = '/video?o=mv&page=' + page;
            }

            Network.request(path, function(html) {
                _this.loading(false);
                var cards = Parser.getCards(html);
                
                if (cards.length > 0) {
                    _this.append(cards);
                    page++;
                } else {
                    if (page === 1) _this.empty('Список пуст.');
                }
            }, function(error) {
                _this.loading(false);
                _this.empty('Ошибка');
                Lampa.Noty.show('Ошибка соединения');
            });
        };

        this.append = function (data) {
            var _this = this;
            data.forEach(function (element) {
                var card = Lampa.Template.get('card', {
                    title: element.title,
                    release_year: element.subtitle
                });
                card.addClass('card--collection');

                if (element.rating) {
                    card.find('.card__view').append('<div style="position:absolute; top:5px; right:5px; background:rgba(0,0,0,0.8); color:#fff; padding:3px 6px; border-radius:4px; font-size:0.8em; font-weight:bold;">'+element.rating+'</div>');
                }

                var img = card.find('.card__img')[0];
                img.onload = function () { card.addClass('card--loaded'); };
                img.onerror = function () { img.src = './img/img_broken.svg'; };
                img.src = element.img;

                card.on('hover:focus', function () {
                    Lampa.Background.change(element.img);
                });

                card.on('hover:enter', function () {
                    _this.openVideo(element.url, element.title);
                });

                scroll.append(card);
                items.push(card);
            });
        };

        this.openVideo = function (url, title) {
            var _this = this;
            Lampa.Loading.start(function () { Lampa.Loading.stop(); });

            var path = url.replace(Manifest.site_url, '');
            
            Network.request(path, function(html) {
                Lampa.Loading.stop();
                var sources = [];

                var flashvarsMatch = html.match(/flashvars_\d+\s*=\s*({.+?});/);
                if (flashvarsMatch && flashvarsMatch[1]) {
                    try {
                        var json = JSON.parse(flashvarsMatch[1]);
                        if (json.mediaDefinitions) {
                            json.mediaDefinitions.forEach(function(m){
                                if (m.videoUrl && m.format === 'mp4') {
                                    sources.push({
                                        title: m.quality + 'p',
                                        url: m.videoUrl,
                                        quality: parseInt(m.quality) || 0
                                    });
                                } else if (m.videoUrl && m.format === 'hls') {
                                    sources.push({
                                        title: 'Auto (HLS)',
                                        url: m.videoUrl,
                                        quality: 1080
                                    });
                                }
                            });
                        }
                    } catch (e) {}
                }

                if (sources.length === 0) {
                    var mp4Regex = /"quality":"(\d+)","videoUrl":"([^"]+)"/g;
                    var match;
                    while ((match = mp4Regex.exec(html)) !== null) {
                        sources.push({
                            title: match[1] + 'p',
                            url: match[2].replace(/\\/g, ''),
                            quality: parseInt(match[1]) || 0
                        });
                    }
                }

                if (sources.length > 0) {
                    sources.sort(function(a,b){ return b.quality - a.quality; });
                    
                    var uniqueSources = [];
                    var seenUrls = new Set();
                    sources.forEach(function(s){
                        if (!seenUrls.has(s.url)) {
                            seenUrls.add(s.url);
                            uniqueSources.push(s);
                        }
                    });

                    Lampa.Select.show({
                        title: 'Выберите качество',
                        items: uniqueSources.map(function(s){
                            s.action = function(){
                                Lampa.Player.play({
                                    url: s.url,
                                    title: title,
                                    timeline: { title: title }
                                });
                            };
                            return s;
                        }),
                        onSelect: function(a){ a.action(); }
                    });
                } else {
                    Lampa.Noty.show('Видео не найдено');
                }

            }, function() {
                Lampa.Loading.stop();
                Lampa.Noty.show('Ошибка');
            });
        };

        this.openSettings = function () {
            Lampa.Input.edit({
                title: 'Пользовательский Proxy',
                value: Storage.get('proxy') || '',
                free: true,
                nosave: true
            }, function (new_proxy) {
                Storage.set('proxy', new_proxy);
                Lampa.Noty.show('Сохранено');
            });
        };

        this.loading = function (status) {
            if (status) this.activity.loader(true);
            else this.activity.loader(false);
        };

        this.empty = function (msg) {
            scroll.append(Lampa.Template.get('empty', {
                title: msg || 'Пусто',
                descr: ''
            }));
        };
    }

    function startPlugin() {
        window.plugin_ph_ready = true;
        Lampa.Component.add('pornhub', PornHub);

        var svg_icon = '<svg width="24px" height="24px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z" fill="currentColor"/></svg>';
        
        var button = $('<li class="menu__item selector" data-action="pornhub"><div class="menu__ico">' + svg_icon + '</div><div class="menu__text">PornHub</div></li>');

        button.on('hover:enter', function () {
            Lampa.Activity.push({ url: '', title: 'PornHub', component: 'pornhub', page: 1 });
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
