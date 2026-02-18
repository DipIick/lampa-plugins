(function () {
    'use strict';

    if (window.pornhub_plugin) return;
    window.pornhub_plugin = true;

    var site_url = 'https://www.pornhub.com';

    var PHStorage = {
        get: function (name) { return Lampa.Storage.get('ph_' + name, ''); },
        set: function (name, value) { Lampa.Storage.set('ph_' + name, value); }
    };

    function fetchContent(path, onSuccess, onError) {
        var network = new Lampa.Reguest();
        var url = site_url + path;
        var custom_proxy = PHStorage.get('proxy');
        
        var proxies = custom_proxy ? [custom_proxy] : [
            'https://corsproxy.io/?',
            'https://api.codetabs.com/v1/proxy?quest=',
            'https://api.allorigins.win/get?url='
        ];

        function tryProxy(index) {
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

                if (!html || html.length < 500 || html.indexOf('captcha') > -1) {
                    tryProxy(index + 1);
                } else {
                    onSuccess(html);
                }
            }, function() {
                tryProxy(index + 1);
            }, false, { dataType: 'text', timeout: 10000 });
        }

        tryProxy(0);
    }

    var Parser = {
        getCards: function(html) {
            var doc = new DOMParser().parseFromString(html, "text/html");
            var cards = [];

            var elements = $(doc).find('li.pcVideoListItem');

            if (elements.length === 0) {
                elements = $(doc).find('.videoBox, li.js-pop');
            }

            elements.each(function () {
                var el = $(this);
                
                var titleEl = el.find('.thumbnail-info-wrapper .title a').first();
                if (titleEl.length === 0) titleEl = el.find('.title a').first();
                if (titleEl.length === 0) titleEl = el.find('a').first();

                var link = titleEl.attr('href');
                if (!link) link = el.find('a').attr('href');

                var title = titleEl.text().trim() || titleEl.attr('title');
                
                var imgEl = el.find('.phimage img').first();
                var img = imgEl.attr('data-mediumthumb') || imgEl.attr('data-thumb_url') || imgEl.attr('data-src') || imgEl.attr('src');
                
                var duration = el.find('.duration').text().trim();
                var views = el.find('.views').text().trim();
                var rating = el.find('.value').text().trim();

                if (link && title) {
                    if (link.indexOf('http') === -1) link = site_url + link;
                    if (img && img.indexOf('http') === -1) img = site_url + img;

                    if (link.indexOf('view_video.php') > -1) {
                        cards.push({
                            title: title,
                            img: img || './img/img_broken.svg',
                            url: link,
                            subtitle: (duration ? duration + ' | ' : '') + views,
                            rating: rating,
                            original: el
                        });
                    }
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
            this.activity.target.find('.search__source').text('PH');
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
            var btn_main = $('<div class="selector search__filter-button" style="margin-right:10px;">Главная</div>');
            btn_main.on('hover:enter', function () { _this.reset(); });
            
            var btn_set = $('<div class="selector search__filter-button">Настройки</div>');
            btn_set.on('hover:enter', function () { _this.openSettings(); });

            controls.append(btn_main).append(btn_set);
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

            var path = '/video?o=mv'; 
            if (search_mode && search_query) {
                 path = '/video/search?search=' + encodeURIComponent(search_query) + '&page=' + page;
            } else if (page > 1) {
                path = '/video?o=mv&page=' + page;
            }

            fetchContent(path, function(html){
                _this.loading(false);
                var cards = Parser.getCards(html);
                if (cards.length > 0) {
                    _this.append(cards);
                    page++;
                } else if (page === 1) {
                    _this.empty('Пусто');
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
                    release_year: element.subtitle
                });
                card.addClass('card--collection');
                
                if (element.rating) {
                     card.find('.card__view').append('<div style="position:absolute; top:5px; right:5px; background:rgba(0,0,0,0.7); color:#fff; padding:2px 6px; border-radius:4px; font-size:0.7em;">'+element.rating+'</div>');
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

            var path = url.replace(site_url, '');
            
            fetchContent(path, function (html) {
                Lampa.Loading.stop();
                var sources = [];

                var flashvars = html.match(/flashvars_\d+\s*=\s*({.+?});/);
                if (flashvars && flashvars[1]) {
                    try {
                        var json = JSON.parse(flashvars[1]);
                        if (json.mediaDefinitions) {
                            json.mediaDefinitions.forEach(function(m){
                                if (m.videoUrl && m.format === 'mp4') {
                                    sources.push({
                                        title: m.quality + 'p',
                                        url: m.videoUrl,
                                        quality: parseInt(m.quality)
                                    });
                                } else if (m.videoUrl && m.format === 'hls') {
                                    sources.push({
                                        title: 'HLS',
                                        url: m.videoUrl,
                                        quality: 1080
                                    });
                                }
                            });
                        }
                    } catch (e) {}
                }

                if (sources.length > 0) {
                    sources.sort(function(a,b){ return b.quality - a.quality; });
                    
                    Lampa.Select.show({
                        title: 'Качество',
                        items: sources.map(function(s){
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

            }, function () {
                Lampa.Loading.stop();
                Lampa.Noty.show('Ошибка');
            });
        };

        this.openSettings = function () {
            Lampa.Input.edit({
                title: 'Свой Proxy',
                value: PHStorage.get('proxy') || '',
                free: true,
                nosave: true
            }, function (new_proxy) {
                PHStorage.set('proxy', new_proxy);
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

        var button = $('<li class="menu__item selector" data-action="pornhub"><div class="menu__ico"><svg width="24px" height="24px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z" fill="currentColor"/></svg></div><div class="menu__text">PH</div></li>');

        button.on('hover:enter', function () {
            Lampa.Activity.push({ url: '', title: 'PH', component: 'pornhub', page: 1 });
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
