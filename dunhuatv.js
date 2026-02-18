(function () {
    'use strict';

    var Manifest = {
        id: 'ph_global_v4',
        version: '4.0.0',
        name: 'PH Global',
        component: 'ph_component_v4',
        source: 'https://www.pornhub.com',
        // Используем allorigins, он часто стабильнее для текста
        proxy: 'https://api.allorigins.win/raw?url=' 
    };

    var Lampa = window.Lampa;
    var Network = Lampa.Network;
    var Storage = Lampa.Storage;

    var Api = {
        get: function (method, success, error) {
            var url = Manifest.source + method;
            var proxy = Storage.get('ph_proxy_url', Manifest.proxy);
            var final = proxy + encodeURIComponent(url);
            
            // Простой запрос без заголовков, чтобы не злить CORS
            Network.silent(final, function(str) {
                success(str);
            }, function(a, c) {
                error(a, c);
            });
        },

        list: function (html) {
            var items = [];
            var doc = new DOMParser().parseFromString(html, 'text/html');
            
            // Универсальный поиск блоков
            var elements = doc.querySelectorAll('.pcVideoListItem, .videoblock, .phimage, li[data-video-id]');
            
            elements.forEach(function (el) {
                var link_el = el.querySelector('a');
                var img_el = el.querySelector('img');
                var title_el = el.querySelector('.title a, .videoTitle, .title');
                var dur_el = el.querySelector('.duration, .duration-token');
                
                if (link_el && img_el) {
                    var link = link_el.getAttribute('href');
                    // Отсеиваем рекламу и левые ссылки
                    if(!link || link.indexOf('viewkey') === -1) return;

                    var title = title_el ? (title_el.getAttribute('title') || title_el.innerText) : 'Video';
                    
                    // PH любит прятать картинки в data атрибутах
                    var img = img_el.getAttribute('data-mediumthumb') || 
                              img_el.getAttribute('data-src') || 
                              img_el.getAttribute('data-thumb_url') || 
                              img_el.src;
                              
                    var duration = dur_el ? dur_el.innerText.trim() : '';
                    
                    items.push({
                        type: 'video',
                        title: title,
                        url: link,
                        img: img,
                        duration: duration
                    });
                }
            });
            
            var next = doc.querySelector('.pagination_next a, .page_next a, #next');
            var next_page = next ? next.getAttribute('href') : false;

            return { results: items, page: next_page };
        },

        extract: function (html) {
            // Ищем JSON с данными видео (стандартный метод PH)
            var match = html.match(/flashvars_\d+\s*=\s*({.+?});/) || html.match(/var\s+flashvars\s*=\s*({.+?});/);
            var result = {};

            if (match) {
                try {
                    var json = JSON.parse(match[1]);
                    result = {
                        title: json.video_title,
                        img: json.image_url,
                        videos: []
                    };

                    if (json.mediaDefinitions) {
                        json.mediaDefinitions.forEach(function (v) {
                            if (v.format === 'mp4' && v.videoUrl) {
                                var q = Array.isArray(v.quality) ? v.quality[0] : v.quality;
                                result.videos.push({
                                    title: q + 'p',
                                    quality: parseInt(q) || 0,
                                    url: v.videoUrl
                                });
                            }
                        });
                    }
                    result.videos.sort(function(a,b){ return b.quality - a.quality });
                } catch (e) { console.log('PH JSON Parse Error', e); }
            }
            return result;
        }
    };

    function Component(object) {
        var comp = new Lampa.InteractionMain(object);

        comp.create = function () {
            this.activity.loader(true);
            return this.render();
        };

        comp.start = function () {
            this.build();
        };

        comp.build = function () {
            var _this = this;
            this.activity.head = Lampa.Template.get('head', { title: 'PH Global' });
            
            this.activity.head.querySelector('.open--search').addEventListener('click', function () {
                Lampa.Input.edit({
                    title: 'Поиск',
                    value: '',
                    free: true,
                    nosave: true
                }, function (new_value) {
                    _this.activity.line.find('.card').remove();
                    _this.activity.loader(true);
                    _this.load('/video/search?search=' + encodeURIComponent(new_value));
                });
            });

            this.activity.line = Lampa.Template.get('items_line', { title: 'Рекомендации' });
            this.activity.render().find('.activity__body').append(this.activity.head);
            this.activity.render().find('.activity__body').append(this.activity.line);
            
            this.load('/');
        };

        comp.load = function (endpoint) {
            var _this = this;
            
            Api.get(endpoint, function(html) {
                // Диагностика ответа
                if(html.length < 500) {
                     Lampa.Noty.show('Ошибка: Ответ слишком короткий (' + html.length + ')');
                }
                
                var data = Api.list(html);
                
                if(data.results.length === 0) {
                     if(html.indexOf('captcha') > -1) Lampa.Noty.show('Блокировка: Капча');
                     else if(html.indexOf('Access Denied') > -1) Lampa.Noty.show('Блокировка: Доступ запрещен');
                     else Lampa.Noty.show('Ничего не найдено (Парсер не сработал)');
                }
                
                _this.append(data);
                _this.activity.loader(false);
            }, function(a, c) {
                _this.activity.loader(false);
                Lampa.Noty.show('Ошибка сети: ' + c);
                _this.activity.empty();
            });
        };

        comp.append = function (data) {
            var _this = this;
            
            if(!data.results.length) {
                var empty = Lampa.Template.get('empty', {title: 'Пусто', descr: 'Попробуйте сменить прокси в настройках'});
                this.activity.line.append(empty);
                return;
            }

            data.results.forEach(function (element) {
                var card = Lampa.Template.get('card', {
                    title: element.title,
                    release_year: element.duration
                });
                
                card.addClass('card--video');
                var img = card.find('.card__img')[0];
                img.onload = function () { card.addClass('card--loaded'); };
                img.onerror = function () { img.src = './img/img_broken.svg'; };
                img.src = element.img;

                card.on('hover:enter', function () {
                    Lampa.Activity.push({
                        url: element.url,
                        title: element.title,
                        component: 'ph_view_v4',
                        page: 1
                    });
                });
                
                _this.activity.line.append(card);
            });

            if (data.page) {
                var more = Lampa.Template.get('more');
                more.on('hover:enter', function () {
                    _this.activity.line.find('.selector').remove();
                    _this.load(data.page);
                });
                this.activity.line.append(more);
            }
            
            this.activity.toggle();
        };

        return comp;
    }

    function View(object) {
        var comp = new Lampa.InteractionMain(object);

        comp.create = function () {
            this.activity.loader(true);
            return this.render();
        };

        comp.start = function () {
            var _this = this;
            Api.get(object.url, function(html){
                var data = Api.extract(html);
                if(data.videos && data.videos.length){
                    _this.show(data);
                } else {
                    Lampa.Noty.show('Видео не найдено (Login required?)');
                    _this.activity.empty();
                }
            }, function(){
                _this.activity.empty();
            });
        };
        
        comp.show = function(data) {
            var _this = this;
            var desc = Lampa.Template.get('description', {
                title: data.title,
                descr: ''
            });
            
            Lampa.Activity.active().activity.render().find('.background').attr('src', data.img);

            var btn = Lampa.Template.get('button', { title: 'Смотреть' });
            btn.on('hover:enter', function(){
                Lampa.Select.show({
                    title: 'Качество',
                    items: data.videos,
                    onSelect: function(v){
                        var vid = {
                            title: data.title,
                            url: v.url,
                            timeline: { hash: Lampa.Utils.uid(data.title) }
                        };
                        Lampa.Player.play(vid);
                        Lampa.Player.playlist([vid]);
                    }
                });
            });
            
            this.activity.render().find('.activity__body').append(desc);
            this.activity.render().find('.activity__body').append(btn);
            this.activity.loader(false);
            this.activity.toggle();
        };

        return comp;
    }

    if (!window.ph_v4_loaded) {
        window.ph_v4_loaded = true;
        
        Lampa.Component.add('ph_component_v4', Component);
        Lampa.Component.add('ph_view_v4', View);

        Lampa.Listener.follow('app', function (e) {
            if (e.type == 'ready') {
                var ico = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 3a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h6zm10 0a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h6z"/></svg>';
                var item = Lampa.Template.get('activity_menu_item', {
                    title: 'PH',
                    icon: ico
                });
                item.on('hover:enter', function () {
                    Lampa.Activity.push({
                        url: '',
                        title: 'PH',
                        component: 'ph_component_v4',
                        page: 1
                    });
                });
                $('.activity__menu .activity__menu-list').append(item);
            }
        });
        
        Lampa.Settings.listener.follow('open', function (e) {
            if(e.name == 'main') {
                var item = Lampa.Template.get('settings_param', {
                    name: 'PH Proxy',
                    value: Storage.get('ph_proxy_url', Manifest.proxy),
                    descr: 'Поменяйте, если не грузит'
                });
                item.on('hover:enter', function(){
                    Lampa.Input.edit({
                        title: 'Proxy URL',
                        value: Storage.get('ph_proxy_url', Manifest.proxy),
                        free: true
                    }, function(val){
                        Storage.set('ph_proxy_url', val);
                        item.find('.settings-param__value').text(val);
                    });
                });
                e.body.find('.settings-param__body').append(item);
            }
        });
        
        console.log('PH v4 Loaded');
    }
})();
